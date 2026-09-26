/**
 * C48 页面脚本管线回归测试（fixture 版）
 * @see docs/c48-integration-plan.md D-verify
 *
 * 用两个本地 HTTP 端口模拟跨域 iframe（OOPIF）：
 * - 主页：中控台详情壳（互动工具入口 / 优惠券红包按钮 / ant-modal 壳 + 跨域 iframe）
 * - iframe：优惠券弹窗（自有权益 / 券表格 / OK / 投放渠道 / 协议勾选 / 投放+二次确认）
 *
 * 验证管道：flat autoAttach 帧附着 → 页面脚本注入（主+帧）→ 段函数交互
 *   → CDP Network 域捕获 userBenefitList.do 响应。
 *
 * 运行：pnpm test:c48-fixture
 * 说明：Fusion cascader 浮层等高保真交互不在 fixture 覆盖范围（真实页面人工 E2E 验证）。
 */
import { spawn } from 'child_process'
import { mkdtempSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import WebSocket from 'ws'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
]
const chromePath = CHROME_PATHS.find((p) => existsSync(p))
if (!chromePath) {
  console.error('FAIL: Chrome not found')
  process.exit(1)
}

// ---------- fixture HTML ----------
const couponRows = [
  { id: '7001001', name: '测试券甲' },
  { id: '8152947823', name: '测试券乙' }
]

const mainHtml = () => `<!doctype html><html><head><title>直播中控台</title></head><body>
<div class="sidebar"><span>互动工具</span></div>
<nav><button role="tab">全部</button></nav>
<main>
  <button id="entry">优惠券红包</button>
</main>
<div class="ant-modal-wrap"><div class="ant-modal" role="dialog">
    <h3>优惠券红包</h3>
  <button aria-label="Close" class="ant-modal-close"
    onclick="this.closest('.ant-modal-wrap').remove();document.getElementById('framehost').remove()"></button>
  <div id="framehost"><iframe id="couponFrame" src="http://localhost:${process.env.PORT_B}/coupon" style="width:600px;height:400px"></iframe></div>
</div></div>
<script>
document.getElementById('entry').addEventListener('click', () => {
  document.querySelector('.ant-modal-wrap').style.display = 'block'
})
</script>
</body></html>`

const couponHtml = `<!doctype html><html><head><title>coupon</title></head><body>
<!-- 模拟真实页面的周边文本密度（findFieldRoot 以 600 字符阈值向上收敛） -->
<p style="display:none">${'直播间商品讲解与优惠活动说明。'.repeat(60)}</p>
<button id="ownBenefit">自有权益&授权的权益</button>
<table><tbody>
${couponRows.map((r) => `<tr class="next-table-row" data-tpl="${r.id}"><td>渠道</td><td>${r.name}</td><td><label><input type="radio" name="row-radio"></label></td></tr>`).join('')}
</tbody></table>
<div class="alp-dl-item"><label class="alp-dl-label">领取条件</label>
  <div class="claim-inline"><label><input type="radio" name="claim"><span>不限</span></label></div></div>
<div class="alp-dl-item"><label class="alp-dl-label">投放渠道</label>
  <div class="channel-inline"><label><input type="radio" name="ch"><span>不限</span></label></div></div>
<label id="agreement"><input type="checkbox"><span>我已阅读并确认直播间红包技术服务协议</span></label>
<button class="alp-dl-btn" onclick="launch()">投 放</button>
<script>
function launch() {
  const d = document.createElement('div')
  d.setAttribute('role', 'dialog')
  d.innerHTML = '<button id="confirmPush">已检查完成，确认投放</button>'
  document.body.appendChild(d)
}
document.getElementById('ownBenefit').addEventListener('click', async () => {
  await fetch('/userBenefitList.do', { method: 'POST' })
})
</script>
</body></html>`

const benefitListBody = JSON.stringify({
  data: {
    list: couponRows.map((r, i) => ({
      couponName: r.name,
      feature: `sceneId:1;templateId:${r.id};idx:${i}`
    }))
  }
})

function serve(bodyFn, contentType) {
  return createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(typeof bodyFn === 'function' ? bodyFn(req.url) : bodyFn)
  })
}

const serverMain = serve((url) => (url === "/" ? mainHtml() : "not found"), 'text/html; charset=utf-8')
const serverCoupon = serve((url) => {
  if (url === '/coupon') return couponHtml
  if (url?.startsWith('/userBenefitList.do')) return benefitListBody
  return 'not found'
}, 'text/html; charset=utf-8')

await new Promise((r) => serverMain.listen(0, '127.0.0.1', r))
await new Promise((r) => serverCoupon.listen(0, '127.0.0.1', r))
const PORT_B = serverCoupon.address().port
process.env.PORT_B = String(PORT_B)

// ---------- Chrome ----------
const profileDir = mkdtempSync(join(tmpdir(), 'dock-c48-'))
const port = 9334
const child = spawn(chromePath, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check'
], { stdio: 'ignore' })

async function waitCdp(timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (resp.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('CDP timeout')
}

let exitCode = 0
const results = []
function assert(name, cond) {
  results.push({ name, ok: Boolean(cond) })
  console.log(`${cond ? '✓' : '✗'} ${name}`)
}

try {
  await waitCdp()
  const targetsResp = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await targetsResp.json()
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  const wsUrl = page.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`)

  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

  let msgId = 1
  const pending = new Map()
  const eventListeners = new Set()
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id && pending.has(msg.id)) {
      const { res } = pending.get(msg.id)
      pending.delete(msg.id)
      res(msg)
    } else if (msg.method) {
      for (const fn of eventListeners) fn(msg)
    }
  })
  const send = (method, params, sessionId) =>
    new Promise((res) => {
      const id = msgId++
      pending.set(id, { res })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  const evaluate = async (expression, sessionId) => {
    const msg = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (msg.error) {
      throw new Error(`CDP protocol error (${msg.error.code}): ${msg.error.message}`)
    }
    if (msg.result?.exceptionDetails) {
      throw new Error(msg.result.exceptionDetails.exception?.description ?? 'page exception')
    }
    return msg.result?.result?.value
  }

  // 附着事件收集（OOPIF 首次附着 url 为空，靠 targetInfoChanged 补全）
  const attached = new Map()
  eventListeners.add((msg) => {
    if (msg.method === 'Target.attachedToTarget' && msg.params?.targetInfo) {
      attached.set(msg.params.sessionId, { ...msg.params.targetInfo })
    }
    if (msg.method === 'Target.targetInfoChanged' && msg.params?.targetInfo?.targetId) {
      // 该事件为按 targetId 的广播，不带 sessionId
      for (const info of attached.values()) {
        if (info.targetId === msg.params.targetInfo.targetId) {
          Object.assign(info, msg.params.targetInfo)
        }
      }
    }
    if (msg.method === 'Target.detachedFromTarget' && msg.params?.sessionId) {
      attached.delete(msg.params.sessionId)
    }
  })

  // 先启用 flat autoAttach 再导航（与生产 task-executor 顺序一致），
  // 确保页面加载时创建的跨域 iframe target 能触发附着事件
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })

  // 导航主页
  await send('Page.navigate', { url: `http://127.0.0.1:${serverMain.address().port}/` })
  await new Promise((r) => setTimeout(r, 1200))

  const findSession = (substr) => {
    for (const [sessionId, info] of attached) {
      if ((info.url ?? '').toLowerCase().includes(substr)) return sessionId
    }
    return undefined
  }
  let couponSessionId
  for (let i = 0; i < 40 && !couponSessionId; i++) {
    couponSessionId = findSession(`localhost:${PORT_B}`)
    if (!couponSessionId) await new Promise((r) => setTimeout(r, 250))
  }
  assert('A1: cross-origin iframe attached via flat autoAttach', Boolean(couponSessionId))

  // 注入页面脚本
  const bundle = readFileSync(join(root, 'src/main/automation/page-script/dist/page-bundle.js'), 'utf-8')
  await evaluate(bundle)
  await evaluate(bundle, couponSessionId)
  assert('A3: script injected into page main world', await evaluate('Boolean(window.__BD && window.__BDC48)'))
  assert('A3: script injected into coupon frame world',
    await evaluate('Boolean(window.__BD && window.__BDC48)', couponSessionId))

  // 幂等注入（OOPIF target 可能被 Chrome 更换，每段前按 URL 重解析最新 sessionId）
  const ensureInjected = async (sessionId) => {
    let sid = findSession(`localhost:${PORT_B}`) ?? sessionId
    if (!(await evaluate('Boolean(window.__BDC48)', sid))) {
      await evaluate(bundle, sid)
    }
    return sid
  }

  // Network 捕获准备（先 enable 再触发请求）
  await send('Network.enable', {}, couponSessionId)
  const capturedResponses = []
  eventListeners.add((msg) => {
    if (msg.method === 'Network.responseReceived' && msg.sessionId === couponSessionId) {
      capturedResponses.push({ requestId: msg.params.requestId, url: msg.params.response?.url ?? '' })
    }
  })

  // 段 2：开弹窗
  const opened = await evaluate('window.__BDC48.openCouponDialog()')
  assert('D: openCouponDialog ok', opened.ok === true)

  // 段 3：自有权益（fixture 中行已渲染 → listReadyInFrame）
  couponSessionId = await ensureInjected(couponSessionId)
  const prep = await evaluate('window.__BDC48.prepareOwnBenefit()', couponSessionId)
  assert('D: prepareOwnBenefit listReadyInFrame', prep.listReadyInFrame === true)

  // 触发列表请求并等待响应体捕获
  await evaluate('fetch("/userBenefitList.do", { method: "POST" })', couponSessionId)
  await new Promise((r) => setTimeout(r, 300))
  const hit = capturedResponses.find((r) => r.url.includes('/userBenefitList.do'))
  let rows = []
  if (hit) {
    const bodyMsg = await send('Network.getResponseBody', { requestId: hit.requestId }, couponSessionId)
    rows = extractCouponRows(JSON.parse(bodyMsg.result.body))
  }
  assert('A2/D: network capture extracted templateIds',
    rows.some((r) => r.templateId === '8152947823'))

  // 段 4a：按名称选券
  await ensureInjected(couponSessionId)
  const selByName = await evaluate(
    'window.__BDC48.selectCouponByName("测试券甲")', couponSessionId)
  assert('D: selectCouponByName', selByName.benefitSelected === true)

  // 段 4b：按 ID 选券（切换勾选到乙）
  const selById = await evaluate(
    `window.__BDC48.selectCouponById("8152947823", ${JSON.stringify(rows)})`,
    couponSessionId)
  assert('D: selectCouponById switches radio', selById.ok === true &&
    await evaluate(`document.querySelectorAll('tbody tr')[1].querySelector('input').checked`, couponSessionId))

  // 段 5：OK + 领取条件 + 渠道不限
  await ensureInjected(couponSessionId)
  const fin = await evaluate(
    'window.__BDC48.confirmBenefitOkAndUnlimited(["不限"])', couponSessionId)
  assert('D: confirmBenefitOkAndUnlimited', fin.ok === true)

  // 段 6：协议 + 投放 + 二次确认
  const push = await evaluate('window.__BDC48.pushCouponAndCloseDialog()', couponSessionId)
  assert('D: pushCouponAndCloseDialog', push.pushClicked === true && push.pushConfirmed === true)

  // 段 7：顶层关壳
  const closed = await evaluate('window.__BDC48.closeCouponShellDialog()')
  assert('D: closeCouponShellDialog', closed.dialogClosed === true)
} catch (err) {
  console.error('FAIL:', err.message)
  exitCode = 1
} finally {
  child.kill('SIGKILL')
  serverMain.close()
  serverCoupon.close()
  if (exitCode === 0 && results.some((r) => !r.ok)) exitCode = 1
  console.log(exitCode === 0 ? 'PASS: c48 fixture pipeline regression passed' : 'FAIL: see assertions above')
  process.exit(exitCode)
}

/** 与 src/main/automation/features/c48-coupon-send/coupon-list.ts 同逻辑的测试副本 */
function extractCouponRows(value) {
  const rows = []
  const seen = new Set()
  let cursor = 0
  const visit = (node) => {
    if (node === null || node === undefined || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) { for (const item of node) visit(item); return }
    const record = node
    let name
    for (const key of ['couponName', 'showBenefitName', 'benefitName', 'templateName', 'name', 'title']) {
      if (typeof record[key] === 'string' && record[key].trim()) { name = record[key].trim(); break }
    }
    let tpl
    if (typeof record.feature === 'string') {
      for (const seg of record.feature.split(';')) {
        const idx = seg.indexOf(':')
        if (idx > 0 && seg.slice(0, idx).trim() === 'templateId') { tpl = seg.slice(idx + 1).trim(); break }
      }
    }
    const topId = record.templateId ?? record.template_id ?? record.cloudTemplateId
    const templateId = tpl ?? (topId != null ? String(topId) : undefined)
    if (templateId) { rows.push({ templateId, name, order: cursor }); cursor += 1 }
    for (const key of Object.keys(record)) visit(record[key])
  }
  visit(value)
  return rows
}
