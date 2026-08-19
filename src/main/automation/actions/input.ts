import type { PageAdapter } from '../../../shared/types'

/**
 * 输入文本到页面元素
 * @see 文档 7.1 automation/actions/input.ts
 *
 * 通过原生 setter + 事件派发实现，兼容 React/Vue 等受控组件。
 */
export async function input(page: PageAdapter, selector: string, value: string): Promise<void> {
  await page.waitForSelector(selector, 10_000)
  await page.input(selector, value)
}