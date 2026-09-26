import type { WebContents } from 'electron'
import type { PageAdapter } from '../../../shared/types'

/**
 * 页面适配器（嵌入式 Electron WebContents 实现，ADR-0001）
 * @see 文档 7.2 PageAdapter
 *
 * 与 CdpPageAdapter 逐方法对应：
 * - navigate → loadURL（ERR_ABORTED 视为被后续导航接管，不视为失败）
 * - evaluate → executeJavaScript（自动 await Promise；页面异常透出为 PG_EVAL_FAILED）
 * - screenshot → capturePage（stayHidden：隐藏窗口下仍可出图，失败截图依赖）
 * - waitForSelector/click/input → 复用与 CDP 版相同的页面 JS 片段
 */

/** loadURL 被后续导航/下载打断（Chromium ERR_ABORTED），交由导航观察者处理 */
function isAbortError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('ERR_ABORTED') || message.includes('Aborted')
}

export class ElectronPageAdapter implements PageAdapter {
  constructor(private readonly webContents: WebContents) {}

  async navigate(url: string): Promise<void> {
    try {
      await this.webContents.loadURL(url)
    } catch (err) {
      if (isAbortError(err)) return
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`PG_NAVIGATE_FAILED: ${message.slice(0, 300)}`)
    }
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
    try {
      return (await this.webContents.executeJavaScript(expression, true)) as T
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`PG_EVAL_FAILED: ${message.slice(0, 500)}`)
    }
  }

  async screenshot(name: string): Promise<string> {
    const image = await this.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true
    })
    void name
    return image.toPNG().toString('base64')
  }
}
