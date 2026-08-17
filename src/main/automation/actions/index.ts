/**
 * 基础操作封装
 * @see 文档 7.1 automation/actions/
 *
 * 提供给任务脚本使用的高层 API：
 * - click / input / wait / navigate / screenshot
 * - 复用 PageAdapter
 *
 * Phase 3 完整实现
 */

import type { PageAdapter } from '../../../shared/types'

export async function click(page: PageAdapter, selector: string): Promise<void> {
  await page.click(selector)
}

export async function input(page: PageAdapter, selector: string, value: string): Promise<void> {
  await page.input(selector, value)
}

export async function waitFor(page: PageAdapter, selector: string, timeoutMs = 10_000): Promise<void> {
  await page.waitForSelector(selector, timeoutMs)
}

export async function navigate(page: PageAdapter, url: string): Promise<void> {
  await page.navigate(url)
}

export async function screenshot(page: PageAdapter, name: string): Promise<string> {
  return page.screenshot(name)
}
