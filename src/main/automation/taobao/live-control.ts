import type { PageAdapter } from '../../../shared/types'

/**
 * 淘宝直播中控台操作
 * @see 文档 7.1 taobao/live-control.ts
 *
 * 提供中控台自动化操作：
 * - 开始直播
 * - 结束直播
 * - 配置商品
 * - 设置优惠券
 *
 * Phase 3 完整实现
 */

const LIVE_CONTROL_URL = 'https://live.taobao.com/admin'

export async function gotoLiveControl(page: PageAdapter): Promise<void> {
  await page.navigate(LIVE_CONTROL_URL)
  await page.waitForSelector('.control-container', 30_000)
}

export async function startLive(page: PageAdapter): Promise<void> {
  await page.click('.start-live-btn')
}

export async function stopLive(page: PageAdapter): Promise<void> {
  await page.click('.stop-live-btn')
}

export async function listProducts(page: PageAdapter): Promise<unknown[]> {
  return page.evaluate<unknown[]>(`
    Array.from(document.querySelectorAll('.product-item')).map(el => ({
      id: el.dataset.id,
      title: el.querySelector('.title')?.textContent?.trim(),
      price: el.querySelector('.price')?.textContent?.trim()
    }))
  `)
}
