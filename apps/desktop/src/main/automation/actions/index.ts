/**
 * 基础操作封装
 * @see 文档 7.1 automation/actions/
 *
 * 提供给任务脚本使用的高层 API：
 * - click / input / wait / navigate / screenshot
 * - 复用 PageAdapter
 */

export { click } from './click'
export { input } from './input'
export { waitFor, sleep } from './wait'
export { navigate } from './navigate'
export { screenshot } from './screenshot'