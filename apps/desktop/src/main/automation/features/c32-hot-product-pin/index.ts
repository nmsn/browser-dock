import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { registerFeature, type EmbeddedFeatureContext, type FeatureContext, type FeatureRunResult } from '../registry'
import { buildLiveDetailUrl } from '../../taobao/live-detail-url'
import { SCREENSHOTS_PATH } from '../../../config'
import pageBundle from '../../page-script/dist/page-bundle.js?raw'

/**
 * C32 爆品置顶（嵌入式执行宿主，ADR-0001）
 * @see docs/glossary.md「爆品置顶」/ freelive-browser-extension c32-hot-product-pin
 *
 * 忠实移植扩展的整段编排（background-handler.ts + content-handler.ts 拆分在
 * 主进程编排 / 页面 API 两层完成，页面侧见 page-script vendor page-api.ts）：
 *
 * 列表段：导航直播计划页 → 按 ID 搜索 → 点「直播详情」→ 主进程捕获详情地址
 * 详情段：导航详情页 → 开播状态探测（未开播刷新重探一次）→ 口袋商品区就绪门禁
 *         → 逐商品「维度切商品ID → 搜索 → 置顶 → 弹窗状态机」（1s 间隔）
 * 收尾：  全部成功清空搜索；有失败保留现场并回填首个失败 ID → 失败截图
 *         → finally 回列表恢复默认筛选
 *
 * 幂等：已置顶商品（取消置顶图标可见）直接跳过；不做本地重试（失败即终态，
 * 远端模式由 server 重试）。取消：主进程在每次页面调用之间检查 AbortSignal。
 */

/** fixture 模式（ADR-0006）：设置后列表/详情页指向本地 mock 页，用于无登录态全链路验证 */
const FIXTURE_BASE = process.env.BROWSER_DOCK_FIXTURE_BASE?.replace(/\/$/, '') ?? ''

const LIVE_LIST_URL = 'https://liveplatform.taobao.com/restful/index/live/list'
const PAGE_READY_TIMEOUT_MS = 30_000
const DETAIL_READY_TIMEOUT_MS = 40_000
const DETAIL_OPEN_TIMEOUT_MS = 15_000
const PRODUCT_INTERVAL_MS = 1_000

function listUrl(): string {
  return FIXTURE_BASE ? `${FIXTURE_BASE}/live/list` : LIVE_LIST_URL
}

function resolveDetailUrl(liveRoomId: string): string | undefined {
  if (FIXTURE_BASE) {
    const id = liveRoomId.replace(/\D/g, '')
    return id.length >= 6 ? `${FIXTURE_BASE}/live/control?liveId=${id}` : undefined
  }
  return buildLiveDetailUrl(liveRoomId)
}

function isKnownHost(href: string): boolean {
  if (FIXTURE_BASE) return href.startsWith(FIXTURE_BASE)
  return /liveplatform\.taobao\.com/i.test(href)
}

function parseProductIds(payload: Record<string, unknown>): string[] {
  const raw = payload.productIds
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/\r?\n|,|，/)
      : []
  return list.map((id) => String(id).trim()).filter(Boolean).slice(0, 3)
}

function ensureLive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error(`TK_CANCELLED: aborted (${String(signal.reason ?? 'user')})`)
  }
}

interface StepFlags {
  [key: string]: boolean
}

interface C32PageResult extends Record<string, unknown> {
  ok?: boolean
  success?: boolean
  detail?: string
  clicked?: boolean
  matchedRowId?: string
  known?: boolean
  ready?: boolean
  kind?: string
  label?: string
}

export async function runC32PinHotProduct(
  ctx: FeatureContext,
  payload: Record<string, unknown>
): Promise<FeatureRunResult> {
  const emb = ctx as EmbeddedFeatureContext
  const { logger, signal } = emb

  const liveRoomId = typeof payload.liveRoomId === 'string' ? payload.liveRoomId.trim() : ''
  const productIds = parseProductIds(payload)

  const fail = (detail: string, steps: StepFlags = {}): FeatureRunResult => ({
    ok: false,
    detail,
    steps
  })

  // ---- 入参校验（未触达页面的业务校验，失败即终态不重试）----
  if (!liveRoomId) return fail('直播场次ID不能为空')
  if (productIds.length === 0) return fail('商品ID不能为空（每行一个，最多 3 个）')
  if (productIds.length > 3) return fail('商品ID最多 3 个')

  const steps: StepFlags = {}

  /** 页面调用 + 日志回收（页面侧执行日志经 drainLogs 回到 pino） */
  async function callPage<T = C32PageResult>(expression: string): Promise<T> {
    const result = await emb.page.evaluate<T>(expression)
    const logs = await emb.page.evaluate<string[]>('window.__BDC32.drainLogs()')
    for (const line of logs ?? []) {
      const sep = line.indexOf(':')
      const level = line.slice(0, sep)
      const message = line.slice(sep + 1)
      if (level === 'error') logger.error(message)
      else if (level === 'warning') logger.warn(message)
      else logger.info(message)
    }
    return result
  }

  /** 注入页面脚本（幂等：已见 window.__BDC32 跳过） */
  async function ensurePageScript(): Promise<void> {
    const alive = await emb.page.evaluate<boolean>('Boolean(window.__BD && window.__BDC32)')
    if (!alive) {
      await emb.page.evaluate(pageBundle)
    }
  }

  /** 等页面就绪（readyState complete + 已知域名） */
  async function waitPageReady(timeoutMs: number, label: string): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      ensureLive(signal)
      try {
        const state = await emb.page.evaluate<{ rs: string; href: string }>(
          '({ rs: document.readyState, href: location.href })'
        )
        if (state.rs === 'complete' && isKnownHost(state.href)) return
      } catch {
        // 导航过渡期 evaluate 可能失败，忽略重试
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`${label}加载超时（${timeoutMs}ms）`)
  }

  /** 失败现场截图（screenshots/YYYY-MM-DD/c32-<stage>-<ts>.png） */
  async function captureFailureShot(stage: string): Promise<void> {
    try {
      const base64 = await emb.page.screenshot(stage)
      const dayDir = join(SCREENSHOTS_PATH, new Date().toISOString().slice(0, 10))
      mkdirSync(dayDir, { recursive: true })
      const file = join(dayDir, `c32-${stage}-${Date.now()}.png`)
      writeFileSync(file, Buffer.from(base64, 'base64'))
      logger.warn(`C32 failure screenshot saved: ${stage}`, { file })
    } catch (err) {
      logger.warn('C32 failure screenshot failed', { err: err instanceof Error ? err.message : String(err) })
    }
  }

  async function waitProductInterval(): Promise<void> {
    await new Promise((r) => setTimeout(r, PRODUCT_INTERVAL_MS))
  }

  try {
    logger.info('C32 start', { liveRoomId, productIds, fixture: Boolean(FIXTURE_BASE) })

    // ---- 列表段 ----
    ensureLive(signal)
    await emb.page.navigate(listUrl())
    await waitPageReady(PAGE_READY_TIMEOUT_MS, '直播计划页')
    await ensurePageScript()

    const listReady = await callPage<boolean>('window.__BDC32.ensureListReady()')
    steps.liveListOpened = listReady
    if (!listReady) return fail('直播计划页未就绪（按 ID 搜索框未出现），请确认页面可访问', steps)

    const filled = await callPage<boolean>(
      `window.__BDC32.fillLiveListSearch(${JSON.stringify(liveRoomId)})`
    )
    steps.searchFilled = filled
    if (!filled) return fail('未找到或未能填写「按 ID 搜索」输入框', steps)

    // 列表段诊断：按钮数量 / 行文本样本（真实站点排查「详情按钮未找到」用）
    const listDiag = await callPage<string>(
      `JSON.stringify({
        btns: document.querySelectorAll('button[data-tblalog-id="zhiBoXiangQing"]').length,
        rowText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
        readyState: document.readyState
      })`
    )
    logger.info('C32 list diagnostic after fill', { diag: listDiag })

    ensureLive(signal)
    const click = await callPage<C32PageResult>(
      `window.__BDC32.clickLiveDetail(${JSON.stringify(liveRoomId)})`
    )
    steps.liveDetailClicked = Boolean(click.clicked)
    if (!click.ok || !click.clicked) {
      return fail(click.detail ?? '未能进入直播详情', steps)
    }

    // 详情地址：优先 window.open 捕获（主进程 setWindowOpenHandler），回退按 liveId 规则构造
    ensureLive(signal)
    const captured = await emb.waitForWindowOpenUrl(DETAIL_OPEN_TIMEOUT_MS)
    const matchedId = typeof click.matchedRowId === 'string' ? click.matchedRowId : liveRoomId
    const detailHref = captured ?? resolveDetailUrl(matchedId) ?? resolveDetailUrl(liveRoomId)
    if (!detailHref) return fail('未能解析直播详情页地址', steps)
    logger.info('C32 detail url resolved', { detailHref, captured: Boolean(captured) })

    // ---- 详情段 ----
    ensureLive(signal)
    await emb.page.navigate(detailHref)
    await waitPageReady(DETAIL_READY_TIMEOUT_MS, '中控台详情页')
    steps.liveDetailOpened = true
    await ensurePageScript()

    // 开播状态探测：未开播刷新重探一次（对齐扩展 finalizeOpenedDetail）
    let probe = await callPage<C32PageResult>(
      `window.__BDC32.probeDetailStatus(${DETAIL_READY_TIMEOUT_MS})`
    )
    if (probe.known && probe.kind === 'unpublished') {
      logger.warn('C32 detail page unpublished, refresh once and re-probe')
      await emb.page.navigate(detailHref)
      await waitPageReady(DETAIL_READY_TIMEOUT_MS, '中控台详情页')
      await ensurePageScript()
      probe = await callPage<C32PageResult>(
        `window.__BDC32.probeDetailStatus(${DETAIL_READY_TIMEOUT_MS})`
      )
    }
    if (!probe.ready) {
      await captureFailureShot('详情页未就绪现场')
      return fail(
        probe.known
          ? `详情页状态为「${probe.label ?? probe.kind}」，不可执行置顶`
          : '详情页开播状态无法识别（未见直播中/彩排中/未开播）',
        steps
      )
    }

    // 口袋商品区就绪门禁（25s）
    ensureLive(signal)
    const pocketReady = await callPage<boolean>('window.__BDC32.waitPocketUiReady()')
    steps.pocketUiReady = pocketReady
    if (!pocketReady) {
      await captureFailureShot('口袋商品区未就绪现场')
      return fail(
        '口袋商品区未就绪（未见「口袋商品/全部商品」Tab 与商品搜索框）',
        steps
      )
    }

    // ---- 逐商品置顶（1s 间隔；主进程在每次调用间响应取消）----
    interface PinItem {
      ok?: boolean
      productId?: string
      success?: boolean
      detail?: string
      pinConfirmed?: boolean
      pinClicked?: boolean
      productFound?: boolean
    }
    const items: PinItem[] = []
    for (const [index, productId] of productIds.entries()) {
      ensureLive(signal)
      if (index > 0) await waitProductInterval()
      logger.info(`C32 pin product ${index + 1}/${productIds.length}`, { productId })
      const item = await callPage<PinItem>(
        `window.__BDC32.pinProductById(${JSON.stringify(productId)})`
      )
      items.push({
        productId,
        success: Boolean(item.ok),
        detail: typeof item.detail === 'string' ? item.detail : undefined,
        pinConfirmed: Boolean(item.pinConfirmed),
        pinClicked: Boolean(item.pinClicked),
        productFound: Boolean(item.productFound)
      })
      steps[`${productId}`] = Boolean(item.ok)
      if (item.ok) logger.info(`C32 product pinned: ${productId}`, { detail: item.detail })
      else logger.warn(`C32 product pin failed: ${productId}`, { detail: item.detail })
    }

    const allSuccess = items.length > 0 && items.every((item) => item.success)
    const firstFailedItem = items.find((item) => !item.success)

    if (allSuccess) {
      // 成功收尾：清空搜索恢复完整列表
      ensureLive(signal)
      const cleared = await callPage<C32PageResult>('window.__BDC32.clearSearch()')
      steps.searchCleared = Boolean(cleared.ok)
      logger.info('C32 search cleared', { detail: cleared.detail })
      return {
        ok: true,
        detail: `已置顶 ${items.length} 个商品为爆品`,
        steps
      }
    }

    // 失败收尾：保留失败现场（不清搜索），回填首个失败商品 ID 供截图，然后当场截图
    if (firstFailedItem) {
      try {
        await callPage<boolean>(
          `window.__BDC32.refillSearch(${JSON.stringify(firstFailedItem.productId)})`
        )
        await new Promise((r) => setTimeout(r, 800))
      } catch {
        // 回填失败不影响失败结论
      }
      await captureFailureShot('置顶失败现场')
    }
    return fail(
      firstFailedItem?.detail ?? '存在未置顶成功的商品',
      steps
    )
  } catch (err) {
    // 基础设施异常（导航/求值/取消）也保留现场
    if (!(err instanceof Error && err.message.startsWith('TK_CANCELLED'))) {
      await captureFailureShot('执行异常现场')
    }
    throw err
  } finally {
    // 回列表恢复默认筛选（清空 ID、状态=全部）；失败只记日志不阻断
    try {
      await emb.page.navigate(listUrl())
      await waitPageReady(PAGE_READY_TIMEOUT_MS, '直播计划页')
      await ensurePageScript()
      const reset = await callPage<C32PageResult>('window.__BDC32.resetListFilters()')
      logger.info('C32 list filters reset', { detail: reset.detail, ok: reset.ok })
    } catch (err) {
      logger.warn('C32 reset list filters failed (non-blocking)', {
        err: err instanceof Error ? err.message : String(err)
      })
    }
  }
}

registerFeature({
  id: 'c32HotProductPin',
  label: 'C32 爆品置顶',
  runtime: 'embedded',
  fields: [
    {
      key: 'liveRoomId',
      label: '直播场次ID',
      type: 'string',
      required: true,
      placeholder: '例如 123456789012',
      help: '中控台详情页地址中的 liveId'
    },
    {
      key: 'productIds',
      label: '商品ID列表',
      type: 'string',
      required: true,
      placeholder: '每行一个，最多 3 个',
      help: '口袋商品中的商品ID；第 4 个起会触发「替换最后一个爆品」确认（自动处理）'
    },
    {
      key: 'liveStatus',
      label: '直播状态',
      type: 'string',
      help: '预留字段：按 ID 精确搜索后由详情页开播探测兜底，无需筛选'
    }
  ],
  run: runC32PinHotProduct
})
