/**
 * Chrome + CDP 集成测试（文档 12.2 集成测试）
 *
 * 验证：
 * 1. 启动独立 Chrome 实例（独立 user-data-dir）
 * 2. 等待 CDP HTTP 接口可用
 * 3. 获取页面 target 并通过 WebSocket 连接
 * 4. 导航到淘宝登录页
 *
 * 运行：pnpm test:chrome-cdp
 * 依赖本机已安装 Google Chrome
 */
import { spawn } from 'child_process'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import WebSocket from 'ws'

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
]

function findChrome() {
  return CHROME_PATHS.find((p) => existsSync(p))
}

const chromePath = findChrome()
if (!chromePath) {
  console.error('FAIL: Chrome not found. Install Google Chrome or Chromium first.')
  process.exit(1)
}

const profileDir = mkdtempSync(join(tmpdir(), 'dock-test-'))
const port = 9333

console.log(`Spawning Chrome: ${chromePath}`)
console.log(`Profile: ${profileDir}`)

const child = spawn(chromePath, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling'
], { stdio: 'ignore' })

async function waitCdp(timeout = 15000) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeout) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (resp.ok) return await resp.json()
    } catch (err) {
      lastError = err
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`CDP timeout: ${lastError?.message ?? 'unknown'}`)
}

let exitCode = 0

try {
  const version = await waitCdp()
  console.log('✓ CDP HTTP available, browser:', version.Browser)

  const resp = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await resp.json()
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('No page target found')
  console.log('✓ Page target:', page.url)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  console.log('✓ CDP WebSocket connected')

  let id = 1
  const send = (method, params) =>
    new Promise((res) => {
      const msgId = id++
      const handler = (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id === msgId) {
          ws.off('message', handler)
          res(msg)
        }
      }
      ws.on('message', handler)
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  const nav = await send('Page.navigate', { url: 'https://login.taobao.com/member/login.jhtml' })
  if (nav.error) throw new Error(`Navigation failed: ${nav.error.message}`)
  console.log('✓ Page.navigate to Taobao login OK')

  console.log('PASS: Chrome launch + CDP page connection + navigation works!')
} catch (err) {
  console.error('FAIL:', err.message)
  exitCode = 1
} finally {
  child.kill('SIGKILL')
  process.exit(exitCode)
}