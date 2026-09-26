/**
 * 构建页面世界脚本 bundle
 * @see docs/c48-integration-plan.md A3
 *
 * 将 vendor/ 下的页面侧 TS（移植自 freelive-browser-extension，纯浏览器 API）
 * 打包为单个 IIFE 文件，运行时经 CDP Runtime.evaluate 注入。
 *
 * 用法：node scripts/build-page-scripts.mjs
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'src/main/automation/page-script/vendor/src/entry/main.ts')
const outfile = join(root, 'src/main/automation/page-script/dist/page-bundle.js')

mkdirSync(dirname(outfile), { recursive: true })

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  outfile,
  legalComments: 'none',
  logLevel: 'info'
})
