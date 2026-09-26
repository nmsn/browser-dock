import {
  clickElement,
  findElementByText,
  normalizeVisibleText,
} from '../../../../../shared/automation/dom-actions';
import { findClickableByText } from '../../../shared/dom/finders';
import { delay } from '../../../../../shared/automation/delay';
import { waitUntil, WaitTimeout } from '../../../../../shared/automation/wait';
import { describeDomRoots } from '../../../shared/dom/deep-dom';

export type OpenCouponDialogResult = {
  ok: boolean;
  detail: string;
  couponDialogOpened: boolean;
  /** 本 frame 已能看到领取条件/自有权益（少见；多数在跨域 iframe） */
  fillReady: boolean;
};

const ENTRY_LABEL = '优惠券红包';

/**
 * 仅打开「优惠券红包」弹窗（互动工具入口在直播详情顶层）。
 * 弹窗表单在跨域 market.m iframe，本函数不要求本 frame 已有领取条件控件。
 */
export async function openCouponDialog(): Promise<OpenCouponDialogResult> {
  if (isCouponUiReady()) {
    return {
      ok: true,
      detail: '优惠券红包弹窗已打开（本 frame 可见领取条件/自有权益）',
      couponDialogOpened: true,
      fillReady: true,
    };
  }

  await dismissBlockingDialogs();

  const tools = await waitForTextClickable(['互动工具']);
  if (tools) {
    tools.scrollIntoView({ block: 'center', behavior: 'instant' });
    await delay('mid');
  }

  const allTab = findClickableByText('全部')
    ?? findElementByText('全部', { selector: 'button, [role="tab"], span, div', exact: true });
  if (allTab) {
    clickElement(allTab.closest('button, [role="tab"], [role="button"], a') ?? allTab);
  }

  const entry = await waitUntil(() => findCouponEntry(), {
    timeoutMs: WaitTimeout.default,
    intervalMs: 300,
  });
  if (!entry) {
    return {
      ok: false,
      detail: `未找到「${ENTRY_LABEL}」入口。${describeDomRoots()}`,
      couponDialogOpened: false,
      fillReady: false,
    };
  }
  clickElement(entry);

  const fillReady = await waitForCouponUiHint(4000);
  return {
    ok: true,
    detail: fillReady
      ? `已点击「${ENTRY_LABEL}」入口，本 frame 可见领取条件/自有权益`
      : `已点击「${ENTRY_LABEL}」入口；表单可能在子 iframe，需 Background 继续投递`,
    couponDialogOpened: true,
    fillReady,
  };
}

function findCouponEntry(): Element | undefined {
  const exact = findClickableByText(ENTRY_LABEL)
    ?? findElementByText(ENTRY_LABEL, {
      selector: 'button, [role="button"], [role="tab"], a, span, div',
      exact: true,
    });
  if (!exact) return undefined;
  const text = normalizeVisibleText(exact.textContent ?? '');
  // 避免点到「投放历史」等长文案节点
  if (text !== ENTRY_LABEL && !text.startsWith(ENTRY_LABEL)) {
    return undefined;
  }
  return exact.closest('button, [role="button"], [role="tab"], a') ?? exact;
}

function isCouponUiReady(): boolean {
  const body = normalizeVisibleText(document.body?.innerText ?? '').slice(0, 8000);
  return (body.includes('领取条件') || body.includes('自有权益'))
    && (body.includes('优惠券') || body.includes('投放渠道') || body.includes('权益投放'));
}

async function waitForCouponUiHint(timeoutMs: number = WaitTimeout.default): Promise<boolean> {
  const ready = await waitUntil(() => isCouponUiReady() || undefined, { timeoutMs, intervalMs: 300 });
  return Boolean(ready);
}

async function dismissBlockingDialogs(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    if (isCouponUiReady()) break;
    const close =
      findClickableByText('关闭')
      ?? document.querySelector<HTMLElement>(
        '.tbla-modal-close, .ant-modal-close, [aria-label="Close"], [aria-label="关闭"]',
      );
    const dialog = document.querySelector(
      '.tbla-modal-content, .ant-modal-content, [role="dialog"]',
    );
    if (!dialog || !close) break;
    const text = normalizeVisibleText(dialog.textContent ?? '');
    if (text.includes(ENTRY_LABEL) || text.includes('领取条件')) break;
    clickElement(close);
    await delay('mid');
  }
}

async function waitForTextClickable(
  texts: string[],
  timeoutMs = WaitTimeout.default,
): Promise<Element | undefined> {
  return waitUntil(() => {
    for (const text of texts) {
      const el = findClickableByText(text);
      if (el) return el;
    }
    return undefined;
  }, { timeoutMs, intervalMs: 300 });
}
