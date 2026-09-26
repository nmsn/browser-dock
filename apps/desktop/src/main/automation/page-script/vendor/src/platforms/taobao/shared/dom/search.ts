import { normalizeVisibleText } from '../../../../shared/automation/dom-actions';

/**
 * 直播计划页「按 ID 搜索」输入框定位（自 freelive-browser-extension dom/search.ts 移植）。
 */

/** 用于识别直播计划页上的场次搜索框（页面态判断等） */
export function findSearchInputCandidate(
  root: ParentNode = document,
): HTMLInputElement | HTMLTextAreaElement | undefined {
  const inputs = Array.from(
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'),
  ).filter((input) => !input.disabled && input.type !== 'hidden');

  const scored = inputs
    .map((input) => ({
      input,
      score: getInputSearchScore(input),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.input ?? (inputs.length === 1 ? inputs[0] : undefined);
}

/** 平台列表工具栏筛选框 placeholder（2026-09 实测） */
const LIVE_LIST_ID_SEARCH_PLACEHOLDER = '输入ID或标题筛选';

function isRendered(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/**
 * 定位直播计划页右上角「按 ID 搜索」输入框。
 * 导航就绪与填表共用，避免 URL 已切计划页但工具栏尚未挂载。
 *
 * 0.4.5 收紧（复盘记录 778：ID 被填进页头全局搜索框）：
 * - 主判定为精确 placeholder「输入ID或标题筛选」（2026-09 实测三轮刷新稳定）；
 * - 兼容路径为列表工具栏证据（与「日历模式/列表模式」切换同容器）；
 * - 删除「属性含 id/ID/场次/直播间/搜索/查询 即命中」的宽匹配（页头 AI 搜索框
 *   `#aiSearchInput` 的 placeholder 随机轮换、可能含「直播间」字样，宽匹配会误命中）
 *   与「全页仅 1 个输入框就采用」的兜底。
 * 找不到即返回 undefined，由上层按既有超时等待/快速失败，ID 不会再被填错位置。
 */
export function findLiveListIdSearchInput(
  root: ParentNode = document,
): HTMLInputElement | HTMLTextAreaElement | undefined {
  const inputs = Array.from(
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'),
  ).filter((input) => {
    if (input.disabled) return false;
    return !['hidden', 'checkbox', 'radio', 'file'].includes(input.type);
  });

  // 1) 精确 placeholder：平台列表工具栏筛选框，2026-09 实测值稳定
  const byPlaceholder = inputs.find(
    (input) => normalizeVisibleText(input.placeholder ?? '') === LIVE_LIST_ID_SEARCH_PLACEHOLDER,
  );
  if (byPlaceholder) return byPlaceholder;

  // 2) 列表工具栏证据：与「日历模式/列表模式」切换同容器的输入框（placeholder 改版兜底）。
  //    跳过状态 Select 内部搜索框（.tbd-select 内 type=search）。
  const toolbarToggle = Array.from(root.querySelectorAll<HTMLElement>('button, span, div')).find(
    (el) =>
      el.children.length === 0 &&
      /日历模式|列表模式/.test(normalizeVisibleText(el.textContent ?? '')) &&
      isRendered(el),
  );
  if (toolbarToggle) {
    let cursor: Element | null = toolbarToggle;
    for (let depth = 0; depth < 8 && cursor; depth += 1) {
      const input = cursor.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])',
      );
      if (input && !input.disabled && !input.closest('.tbd-select, .ant-select')) return input;
      cursor = cursor.parentElement;
    }
  }

  return undefined;
}

export function getInputSearchScore(input: HTMLInputElement | HTMLTextAreaElement): number {
  const haystack = normalizeVisibleText(
    [
      input.placeholder,
      input.name,
      input.id,
      input.getAttribute('aria-label'),
      input.getAttribute('data-spm'),
    ]
      .filter(Boolean)
      .join(' '),
  );

  let score = 0;
  if (/直播|场次|live/i.test(haystack)) score += 2;
  if (/id|ID|编号/.test(haystack)) score += 2;
  if (/搜索|查询/.test(haystack)) score += 1;

  return score;
}
