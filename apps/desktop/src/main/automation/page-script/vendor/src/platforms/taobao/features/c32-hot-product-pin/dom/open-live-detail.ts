import { normalizeVisibleText } from '../../../../../shared/automation/dom-actions';
import {
  waitRequiredValue,
  WaitTimeout,
  type AutomationDomContext,
  type AutomationLogSink,
} from '../../../../../shared/automation/wait';
import { findClickableByText } from '../../../shared/dom/finders';

/**
 * 列表行点「直播详情」（自 freelive-browser-extension c32 dom/open-live-detail.ts 移植）。
 *
 * browser-dock 嵌入式裁剪：扩展版点击后经 MAIN 世界 window.open 捕获 + CDP 兜底解析
 * 目标 URL。嵌入式架构下 window.open 由主进程 setWindowOpenHandler 原生捕获
 * （或同视图导航由 did-navigate 观测），页面侧只需找到按钮并点击一次，
 * URL 解析与详情页打开由主进程编排（features/c32-hot-product-pin/index.ts）负责。
 */

const DETAIL_BUTTON_TEXTS = ['直播详情', '直播详细'] as const;
const DETAIL_BUTTON_LOG_ID = 'zhiBoXiangQing';

export type OpenLiveDetailResult = {
  ok: boolean;
  clicked: boolean;
  detail: string;
  matchedRowId?: string;
};

export type OpenLiveDetailOptions = AutomationDomContext;

export async function openLiveDetailFromList(
  liveRoomId: string,
  ctx: OpenLiveDetailOptions,
): Promise<OpenLiveDetailResult> {
  const { log } = ctx;
  const wantId = normalizeVisibleText(liveRoomId);
  if (!wantId) {
    return { ok: false, clicked: false, detail: '直播场次ID 为空' };
  }

  const detailButton = await waitForDetailButtonForRoom(wantId, log);
  if (!detailButton) {
    const idHost = findSmallestElementContainingId(wantId);
    return {
      ok: false,
      clicked: false,
      detail: idHost
        ? `列表中已出现 ID「${wantId}」，但同条目上未找到「直播详情」按钮（仅直播中通常有）`
        : `列表中未找到含直播场次ID「${wantId}」的条目（请确认搜索结果已刷新）`,
      matchedRowId: idHost ? wantId : undefined,
    };
  }

  const rowText = normalizeVisibleText(
    (detailButton.closest('li') ?? detailButton.parentElement)?.textContent ??
      detailButton.textContent ??
      '',
  );
  const matchedRowId = extractLiveRoomIdFromRow(rowText) ?? wantId;

  // 置顶是单次动作：只点一次。点击后详情地址由主进程捕获（window.open / 同视图跳转）。
  clickOnce(detailButton);
  log('success', `已点击「直播详情」（行场次ID=${matchedRowId}），等待主进程捕获详情地址`);

  return {
    ok: true,
    clicked: true,
    detail: `已点击「直播详情」按钮`,
    matchedRowId,
  };
}

function clickOnce(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', inline: 'center' });
  element.click();
}

async function waitForDetailButtonForRoom(
  liveRoomId: string,
  log: AutomationLogSink,
  timeoutMs: number = WaitTimeout.default,
): Promise<HTMLElement | undefined> {
  return waitRequiredValue(() => findDetailButtonForRoom(liveRoomId), {
    label: '直播详情按钮',
    failureReason: `列表中未找到场次「${liveRoomId}」的「直播详情」按钮`,
    timeoutMs,
    intervalMs: 400,
    log,
  });
}

function findDetailButtonForRoom(liveRoomId: string): HTMLElement | undefined {
  const buttons = collectDetailButtons();

  for (const btn of buttons) {
    if (ancestorContainsId(btn, liveRoomId)) {
      return btn;
    }
  }

  const idHost = findSmallestElementContainingId(liveRoomId);
  if (!idHost) return undefined;

  let scope: HTMLElement | null = idHost;
  for (let depth = 0; depth < 14 && scope; depth += 1) {
    const inScope = collectDetailButtons(scope);
    if (inScope[0]) return inScope[0];
    scope = scope.parentElement;
  }

  return undefined;
}

function collectDetailButtons(root: ParentNode = document): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const result: HTMLElement[] = [];

  const push = (el: Element | null | undefined) => {
    if (!(el instanceof HTMLElement)) return;
    const button = (el.closest('button, [role="button"]') as HTMLElement | null) ?? el;
    if (seen.has(button)) return;
    if (!isVisibleEnough(button)) return;
    seen.add(button);
    result.push(button);
  };

  for (const el of root.querySelectorAll(`button[data-tblalog-id="${DETAIL_BUTTON_LOG_ID}"]`)) {
    push(el);
  }

  for (const text of DETAIL_BUTTON_TEXTS) {
    const found = findClickableByText(text, root);
    if (found) push(found);
  }

  for (const el of root.querySelectorAll('button, [role="button"]')) {
    const label = normalizeVisibleText(el.textContent ?? '');
    if (label === '直播详情' || label === '直播详细') {
      push(el);
    }
  }

  return result;
}

function ancestorContainsId(from: Element, liveRoomId: string): boolean {
  let node: HTMLElement | null = from instanceof HTMLElement ? from : from.parentElement;
  for (let depth = 0; depth < 14 && node; depth += 1) {
    const text = normalizeVisibleText(node.textContent ?? '');
    if (text.includes(liveRoomId)) return true;
    node = node.parentElement;
  }
  return false;
}

function findSmallestElementContainingId(liveRoomId: string): HTMLElement | undefined {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('li, span, div, p, td, a, label, section, article'),
  );

  let best: HTMLElement | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const el of candidates) {
    const text = normalizeVisibleText(el.textContent ?? '');
    if (!text.includes(liveRoomId)) continue;
    if (text.length > 2500) continue;
    if (!isVisibleEnough(el)) continue;

    const rect = el.getBoundingClientRect();
    const area = Math.max(rect.width, 1) * Math.max(rect.height, 1);
    const score = text.length * 10 + area / 1000;
    if (score < bestScore) {
      best = el;
      bestScore = score;
    }
  }

  return best;
}

function extractLiveRoomIdFromRow(rowText: string): string | undefined {
  const labeled = rowText.match(/ID[:：\s]*([0-9]{6,})/i);
  if (labeled?.[1]) return labeled[1];
  const longNumbers = rowText.match(/\b(\d{10,})\b/g);
  if (longNumbers?.length) {
    return longNumbers.sort((a, b) => b.length - a.length)[0];
  }
  return undefined;
}

function isVisibleEnough(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}
