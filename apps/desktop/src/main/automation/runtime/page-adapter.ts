import type { CdpClient } from '../../chrome/cdp-client'
import type { PageAdapter } from '../../../shared/types'

/**
 * 页面适配器（基于 CDP）
 * @see 文档 7.2 PageAdapter
 *
 * 职责：将 PageAdapter 的高级 API 翻译为 CDP 命令
 */

export class CdpPageAdapter implements PageAdapter {
  constructor(private readonly cdp: CdpClient) {}

  /**
   * 启用必要的 CDP 域（文档 6.2 第 8 步）
   */
  async init(): Promise<void> {
    await this.cdp.send('Page.enable')
    await this.cdp.send('Runtime.enable')
  }

  async navigate(url: string): Promise<void> {
    await this.cdp.send('Page.navigate', { url })
  }

  async waitForSelector(selector: string, timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const exists = await this.evaluate<boolean>(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`
      )
      if (exists) return
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`PG_SELECTOR_NOT_FOUND: ${selector}`)
  }

  async click(selector: string): Promise<void> {
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`)
  }

  async input(selector: string, value: string): Promise<void> {
    await this.evaluate(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`
    )
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.cdp.send<{ result: { value: T } }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    return result.result.value
  }

  async screenshot(name: string): Promise<string> {
    const result = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    // 实际保存由调用方负责，这里返回 base64 数据
    void name
    return result.data
  }
}
