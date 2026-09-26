import type { PageAdapter } from '../../../shared/types'

/**
 * 页面导航
 * @see 文档 7.1 automation/actions/navigate.ts
 */
export async function navigate(page: PageAdapter, url: string): Promise<void> {
  await page.navigate(url)
}