import type { PageAdapter } from '../../../shared/types'

/**
 * 页面截图
 * @see 文档 7.1 automation/actions/screenshot.ts
 * 返回 base64 PNG 数据。
 */
export async function screenshot(page: PageAdapter, name: string): Promise<string> {
  return page.screenshot(name)
}