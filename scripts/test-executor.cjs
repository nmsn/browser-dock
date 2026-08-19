/**
 * 任务执行引擎端到端自测
 *
 * 通过 BROWSER_DOCK_SMOKE=1 环境变量启动 Electron 主进程，
 * 主进程内的 runSmokeTest() 会执行完整的：
 * 创建账号 → 创建任务 → Chrome 启动 → CDP 连接 → 沙箱执行 → 写日志 → 释放锁
 *
 * 运行：pnpm test:executor
 */
const { spawn } = require('child_process')

const electronPath = require('electron')
const args = ['.', '--no-sandbox']
const env = { ...process.env, BROWSER_DOCK_SMOKE: '1', ELECTRON_DISABLE_GPU: '1' }

console.log('=== Running executor smoke test ===')
const child = spawn(electronPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })

let output = ''
child.stdout.on('data', (d) => {
  output += d.toString()
})
child.stderr.on('data', (d) => {
  process.stderr.write(d.toString())
})

child.on('close', (code) => {
  const pass = /SMOKE PASS/.test(output)
  console.log(output.split('\n').slice(0, 25).join('\n'))
  console.log(pass ? '\nPASS: Executor smoke test passed' : '\nFAIL: Executor smoke test failed')
  process.exit(pass ? 0 : 1)
})

setTimeout(() => {
  console.log('FAIL: smoke test timed out (45s)')
  child.kill('SIGKILL')
  process.exit(1)
}, 45000)