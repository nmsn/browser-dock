import type { PageAdapter } from '../../../shared/types'

/**
 * 点击页面元素
 * @see 文档 7.1 automation/actions/click.ts / 7.3 插件迁移
 *
 * 优先使用 DOM 语义操作（document.querySelector().click()），
 * 只有业务确实需要真实输入事件时才使用 Input.* 命令（文档 7.3）。
 *
 * 若目标不存在则抛出 PG_SELECTOR_NOT_FOUND。
 */
export async function click(page: PageAdapter, selector: string): Promise<void> {
  await page.waitForSelector(selector, 10_000)
  await page.click(selector)
}