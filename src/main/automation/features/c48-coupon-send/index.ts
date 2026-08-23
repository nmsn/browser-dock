import type { FeatureFieldOption } from '../../../../shared/types'
import { evaluateOnPage, injectPageScript } from '../../page-script'
import { buildLiveDetailUrl } from '../../taobao/live-detail-url'
import { FrameSession } from '../../../chrome/cdp-client'
import { registerFeature, type FeatureContext, type FeatureRunResult } from '../registry'
import {
  C48_CLAIM_CONDITION_TREE,
  C48_DEFAULT_CLAIM_CONDITION_PATH,
  formatClaimConditionPath,
  normalizeClaimConditionPath,
  validateClaimConditionPath
} from './claim-condition'
import { extractCouponRows, type CapturedCouponRow } from './coupon-list'

/**
 * C48 优惠券发放
 * @see docs/c48-integration-plan.md Phase D / 参考项目 features/c48-coupon-send
 *
 * 七段流程：导航详情 → 开弹窗(顶层) → 自有权益(coupon iframe)
 *   → 选券(同域或 smf iframe，支持按 ID 网络捕获匹配) → 确认+领取条件+渠道不限
 *   → 投放+二次确认 → 关壳弹窗(顶层)
 */

const COUPON_IFRAME_PATTERNS = ['app-live-platform-live-coupon', 'live-coupon']
const BENEFIT_FRAME_PATTERNS = ['awardBenefitSelect', 'smf.taobao.com']
const PAGE_READY_TIMEOUT_MS = 30_000
const FRAME_WAIT_TIMEOUT_MS = 20_000

function toOptions(nodes: typeof C48_CLAIM_CONDITION_TREE): FeatureFieldOption[] {
  return nodes.map((node) => ({
    label: node.label,
    value: node.value,
    ...(node.children ? { children: toOptions(node.children) } : {})
  }))
}

function ensureLive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error(`TK_CANCELLED: aborted (${String(signal.reason ?? 'user')})`)
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

interface StepFlags {
  [key: string]: boolean
}

async function runC48CouponSend(
  ctx: FeatureContext,
  payload: Record<string, unknown>
): Promise<FeatureRunResult> {
  const liveRoomId = asString(payload.liveRoomId)
  const couponName = asString(payload.couponName)
  const couponId = asString(payload.couponId)

  const claimPathInput = normalizeClaimConditionPath(payload.claimConditionPath)
  const claimPath =
    claimPathInput.length > 0 ? claimPathInput : [...C48_DEFAULT_CLAIM_CONDITION_PATH]
  const pathError = validateClaimConditionPath(claimPath, C48_CLAIM_CONDITION_TREE)

  const fail = (detail: string, steps: StepFlags = {}): FeatureRunResult => ({
    ok: false,
    detail,
    steps
  })

  // ---- 入参校验（未触达页面的业务校验）----
  if (pathError) return fail(pathError)
  if (!liveRoomId) return fail('直播场次ID不能为空')
  if (!couponName && !couponId) return fail('优惠券名称或优惠券ID不能为空')

  const detailUrl = buildLiveDetailUrl(liveRoomId)
  if (!detailUrl) return fail(`直播场次ID无效：「${liveRoomId}」`)

  const steps: StepFlags = {}

  // ---- 段 1：导航到中控台详情页 ----
  ensureLive(ctx.signal)
  ctx.logger.info('C48 start', { liveRoomId, couponId: couponId || '(n/a)', couponName: couponName || '(n/a)', claimCondition: formatClaimConditionPath(claimPath) })
  await ctx.cdp.send('Page.navigate', { url: detailUrl })
  const ready = await waitMainPageReady(ctx)
  if (!ready.ok) return fail(ready.detail, steps)
  steps.liveDetailOpened = true

  // ---- 段 2：顶层打开「优惠券红包」弹窗 ----
  ensureLive(ctx.signal)
  await injectPageScript(ctx.cdp)
  const openRes = await evaluateOnPage<{ ok: boolean; detail: string; couponDialogOpened: boolean; fillReady?: boolean }>(
    ctx.cdp,
    'window.__BDC48.openCouponDialog()'
  )
  steps.couponDialogOpened = openRes.couponDialogOpened
  ctx.logger.info('C48 open dialog', { detail: openRes.detail })
  if (!openRes.ok) return fail(openRes.detail, steps)

  // ---- 段 3：coupon iframe 点「自有权益」----
  ensureLive(ctx.signal)
  const couponSession = await waitForFrameSession(ctx, COUPON_IFRAME_PATTERNS)
  await enableFrameNetwork(ctx, couponSession)
  await injectPageScript(ctx.cdp, couponSession.sessionId)
  const prep = await couponSession.evaluate<{
    ok: boolean
    detail: string
    ownBenefitOpened: boolean
    listReadyInFrame: boolean
    needsBenefitSelectFrame: boolean
  }>('window.__BDC48.prepareOwnBenefit()')
  steps.ownBenefitOpened = prep.ownBenefitOpened
  ctx.logger.info('C48 prepare benefit', { detail: prep.detail })
  if (!prep.ok && !prep.ownBenefitOpened) return fail(prep.detail, steps)

  // ---- 段 4：选券（同域列表 或 跨域 smf iframe）----
  ensureLive(ctx.signal)
  let capturedRows: CapturedCouponRow[] = []
  if (couponId) {
    // 列表接口在点开自有权益后触发；主进程经 Network 域捕获并抽取行
    capturedRows = await safeWaitCouponRows(ctx, couponId)
  }

  let selectSession: FrameSession = couponSession
  if (prep.needsBenefitSelectFrame && !prep.listReadyInFrame) {
    selectSession = await waitForFrameSession(ctx, BENEFIT_FRAME_PATTERNS)
    await injectPageScript(ctx.cdp, selectSession.sessionId)
  }

  const selectExpr = couponId
    ? `window.__BDC48.selectCouponById(${JSON.stringify(couponId)}, ${JSON.stringify(capturedRows)})`
    : `window.__BDC48.selectCouponByName(${JSON.stringify(couponName)})`
  const selRes = await selectSession.evaluate<{ ok: boolean; detail: string; benefitSelected: boolean }>(selectExpr)
  steps.benefitSelected = selRes.benefitSelected
  ctx.logger.info('C48 select coupon', { detail: selRes.detail })
  if (!selRes.ok) return fail(selRes.detail, steps)

  // ---- 段 5：确认选券 + 领取条件路径 + 投放渠道不限（coupon iframe）----
  ensureLive(ctx.signal)
  const finRes = await couponSession.evaluate<{
    ok: boolean
    detail: string
    benefitConfirmed: boolean
    claimUnlimited: boolean
    claimConditionSet: boolean
    channelUnlimited: boolean
  }>(`window.__BDC48.confirmBenefitOkAndUnlimited(${JSON.stringify(claimPath)})`)
  steps.benefitConfirmed = finRes.benefitConfirmed
  steps.claimUnlimited = finRes.claimUnlimited
  steps.claimConditionSet = finRes.claimConditionSet
  steps.channelUnlimited = finRes.channelUnlimited
  ctx.logger.info('C48 finish options', { detail: finRes.detail })
  if (!finRes.ok) return fail(finRes.detail, steps)

  // ---- 段 6：投放 + 二次确认（coupon iframe）----
  ensureLive(ctx.signal)
  const pushRes = await couponSession.evaluate<{
    ok: boolean
    detail: string
    pushClicked: boolean
    pushConfirmed: boolean
    dialogClosed: boolean
  }>('window.__BDC48.pushCouponAndCloseDialog()')
  steps.pushClicked = pushRes.pushClicked
  steps.pushConfirmed = pushRes.pushConfirmed
  steps.dialogClosed = pushRes.dialogClosed
  ctx.logger.info('C48 push', { detail: pushRes.detail })
  if (!pushRes.ok || !pushRes.pushClicked || !pushRes.pushConfirmed) {
    return fail(pushRes.detail || '优惠券投放未确认', steps)
  }

  // ---- 段 7：顶层关闭壳弹窗 ----
  ensureLive(ctx.signal)
  const closeRes = await evaluateOnPage<{ ok: boolean; detail: string; dialogClosed: boolean }>(
    ctx.cdp,
    'window.__BDC48.closeCouponShellDialog()'
  )
  steps.dialogClosed = closeRes.dialogClosed
  ctx.logger.info('C48 close dialog', { detail: closeRes.detail })
  if (!closeRes.ok) return fail(closeRes.detail, steps)

  return {
    ok: true,
    detail: `已选优惠券「${couponId || couponName}」并完成投放`,
    steps
  }
}

/** 等待页面主 target 导航完成且落在 liveplatform 域 */
async function waitMainPageReady(
  ctx: FeatureContext
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const start = Date.now()
  while (Date.now() - start < PAGE_READY_TIMEOUT_MS) {
    ensureLive(ctx.signal)
    try {
      const state = await evaluateOnPage<{ rs: string; href: string }>(
        ctx.cdp,
        '({ rs: document.readyState, href: location.href })'
      )
      if (state.rs === 'complete' && /liveplatform\.taobao\.com/i.test(state.href)) {
        return { ok: true }
      }
    } catch {
      // 导航过渡期 evaluate 可能失败，忽略重试
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { ok: false, detail: `中控台详情页加载超时（${PAGE_READY_TIMEOUT_MS}ms）` }
}

/** 按 URL 模式依序等待子会话附着 */
async function waitForFrameSession(
  ctx: FeatureContext,
  patterns: string[]
): Promise<FrameSession> {
  let lastErr: Error | null = null
  for (const pattern of patterns) {
    try {
      return await ctx.cdp.waitForSession(pattern, FRAME_WAIT_TIMEOUT_MS)
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw new Error(
    `C48_FRAME_NOT_FOUND: ${patterns.join(' | ')} — ${lastErr?.message ?? 'no attached frame'}`
  )
}

async function enableFrameNetwork(ctx: FeatureContext, session: FrameSession): Promise<void> {
  if (!ctx.network.hasEnabled(session.sessionId)) {
    await ctx.network.enable(ctx.cdp, session.sessionId)
  }
}

/** 等待券列表接口响应并抽取行；超时不致命（回退名称/顺序定位失败信息） */
async function safeWaitCouponRows(
  ctx: FeatureContext,
  couponId: string,
  timeoutMs = 15_000
): Promise<CapturedCouponRow[]> {
  try {
    return await ctx.network.waitFor<CapturedCouponRow>(ctx.cdp, {
      urlPattern: 'userBenefitList.do',
      extract: extractCouponRows,
      dedupeKey: (row) => row.templateId,
      predicate: (rows) => rows.some((row) => row.templateId === couponId),
      timeoutMs
    })
  } catch (err) {
    ctx.logger.warn('C48 coupon list capture timeout; fall back to name matching', { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

registerFeature({
  id: 'c48CouponSend',
  label: 'C48 优惠券发放',
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
      key: 'couponId',
      label: '优惠券ID',
      type: 'string',
      help: '底表优惠券ID（templateId），提供时精确匹配；与名称二选一，ID 优先'
    },
    {
      key: 'couponName',
      label: '优惠券名称',
      type: 'string',
      placeholder: '名称/渠道全等匹配',
      help: '与优惠券ID二选一'
    },
    {
      key: 'claimConditionPath',
      label: '领取条件',
      type: 'cascader',
      options: toOptions(C48_CLAIM_CONDITION_TREE),
      help: '默认「不限」；投放渠道将自动设为不限'
    }
  ],
  run: runC48CouponSend
})
