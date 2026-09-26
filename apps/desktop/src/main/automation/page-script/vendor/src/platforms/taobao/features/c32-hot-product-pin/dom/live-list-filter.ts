import { fillTextInput, normalizeVisibleText } from '../../../../../shared/automation/dom-actions';
import { delay } from '../../../../../shared/automation/delay';
import {
  waitRequiredValue,
  WaitTimeout,
  type AutomationLogSink,
} from '../../../../../shared/automation/wait';
import { findLiveListIdSearchInput } from '../../../shared/dom/search';
import {
  findTbdSelectRoot,
  findTbdSelectTrigger,
  readTbdSelectDisplay,
  selectTbdSelectOptionDetailed,
  tbdSelectDisplayMatches,
} from '../../../shared/dom/adapters';
import { C32_DEFAULT_LIVE_STATUS, C32_LIVE_STATUS_OPTIONS, type C32LiveStatus } from '../types';

export { findLiveListIdSearchInput };

/** 页面按 ID 搜索多为防抖；输入后等待列表刷新 */

/** 状态下拉当前展示或可选值（截图：全部 / 未开播 / 直播中 / 已开播） */
const STATUS_OPTION_TEXTS = [...C32_LIVE_STATUS_OPTIONS, '不限'] as const;

/**
 * 在直播计划页填写按 ID 搜索，并等待防抖搜索生效。
 * 若工具栏尚未挂载，先等到搜索框出现（与 ensureLiveListPage 就绪条件一致）。
 */
export async function fillLiveListIdSearch(
  liveRoomId: string,
  log: AutomationLogSink,
): Promise<boolean> {
  const input = await waitRequiredValue(
    () => findLiveListIdSearchInput() || undefined,
    {
      label: '直播计划页搜索框',
      failureReason: '按 ID 搜索输入框未出现',
      timeoutMs: WaitTimeout.default,
      intervalMs: 250,
      log,
    },
  );
  if (!input) return false;

  fillTextInput(input, liveRoomId);
  await delay('long');
  return (
    normalizeVisibleText(input.value) === normalizeVisibleText(liveRoomId) ||
    input.value.includes(liveRoomId)
  );
}

/**
 * 状态筛选：复用 TBD/Ant Select 适配器（点展示框 → 浮层 → 点目标状态）。
 * 定位：ID 搜索框右侧、当前展示多为「全部」的那个 Select。
 * 注：C32 主流程按 ID 精确搜索后**跳过状态筛选**（记录 86）；
 * 本函数仅被 resetLiveListFilters 的「状态=全部」收尾使用。
 */
export async function applyLiveStatusFilter(
  liveStatus: C32LiveStatus = C32_DEFAULT_LIVE_STATUS,
): Promise<{ ok: boolean; detail: string; diagnostics?: string }> {
  const statusSelect = findLiveListStatusSelect();
  if (!statusSelect) {
    return {
      ok: false,
      detail: '未找到直播计划页状态下拉（搜索框旁展示「全部」的筛选框）',
    };
  }

  if (tbdSelectDisplayMatches(statusSelect, liveStatus)) {
    return {
      ok: true,
      detail: `状态下拉已是「${liveStatus}」，跳过`,
    };
  }

  const before = readTbdSelectDisplay(statusSelect) || '(空)';
  const result = await selectTbdSelectOptionDetailed(statusSelect, liveStatus);
  await delay('long');

  if (result.ok || tbdSelectDisplayMatches(statusSelect, liveStatus)) {
    return {
      ok: true,
      detail: `已选中状态下拉「${liveStatus}」（原展示「${before}」；${result.detail}）`,
    };
  }

  return {
    ok: false,
    detail: `状态下拉选中「${liveStatus}」失败（原展示「${before}」）：${result.detail}`,
  };
}

export type ResetLiveListFiltersResult = {
  ok: boolean;
  detail: string;
  idCleared: boolean;
  statusReset: boolean;
};

/**
 * 恢复直播计划页默认筛选：清空按 ID 搜索，状态切回「全部」。
 * 任务结束回列表后调用；供各模块复用。
 */
export async function resetLiveListFilters(
  log?: AutomationLogSink,
): Promise<ResetLiveListFiltersResult> {
  const sink: AutomationLogSink = log ?? (() => undefined);
  let idCleared = false;
  let statusReset = false;

  const input = await waitRequiredValue(() => findLiveListIdSearchInput() || undefined, {
    label: '直播计划页搜索框',
    failureReason: '按 ID 搜索输入框未出现，无法清空',
    timeoutMs: WaitTimeout.default,
    intervalMs: 250,
    log: sink,
  });

  if (input) {
    const before = normalizeVisibleText(input.value);
    if (!before) {
      idCleared = true;
    } else {
      try {
        fillTextInput(input, '');
      } catch {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await delay('long');
      idCleared = normalizeVisibleText(input.value).length === 0;
    }
  }

  const statusResult = await applyLiveStatusFilter('全部');
  statusReset = statusResult.ok;
  if (!statusReset) {
    sink('warning', `恢复状态「全部」失败：${statusResult.detail}`);
  }

  const ok = idCleared && statusReset;
  const detail = ok
    ? '已恢复列表默认筛选（清空 ID，状态=全部）'
    : [
        idCleared ? 'ID 已清空' : 'ID 未清空',
        statusReset ? '状态=全部' : `状态未恢复：${statusResult.detail}`,
      ].join('；');

  return { ok, detail, idCleared, statusReset };
}

/**
 * 找搜索框同一行/相邻的状态 Select。
 * 截图结构： [ID 搜索] [全部 ▾] [日历模式]
 */
export function findLiveListStatusSelect(): Element | undefined {
  const searchInput = findLiveListIdSearchInput();
  const candidates = collectNearbySelectRoots(searchInput);

  // 1) 展示值就是状态枚举之一（优先「全部」）
  const byDisplay = candidates
    .map((el) => ({ el, display: readTbdSelectDisplay(el) }))
    .filter(({ display }) => STATUS_OPTION_TEXTS.some((t) => display === t || display.includes(t)))
    .sort((a, b) => statusSelectPriority(b.display) - statusSelectPriority(a.display));

  if (byDisplay[0]) return byDisplay[0].el;

  // 2) 几何上：搜索框右侧最近的 Select
  if (searchInput instanceof HTMLElement) {
    const searchRect = searchInput.getBoundingClientRect();
    const toTheRight = candidates
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          el,
          dx: rect.left - searchRect.right,
          dy: Math.abs(rect.top + rect.height / 2 - (searchRect.top + searchRect.height / 2)),
        };
      })
      .filter((item) => item.dx >= -8 && item.dx < 480 && item.dy < 40)
      .sort((a, b) => a.dx - b.dx || a.dy - b.dy);

    if (toTheRight[0]) return toTheRight[0].el;
  }

  return candidates[0];
}

function collectNearbySelectRoots(
  searchInput: HTMLInputElement | HTMLTextAreaElement | undefined,
): Element[] {
  const roots: Element[] = [];
  const seen = new Set<Element>();

  const push = (el: Element | null | undefined) => {
    if (!el) return;
    const root =
      findTbdSelectRoot(el) ??
      (el.matches?.('.tbd-select, .ant-select, [class*="tbd-select"]') ? el : undefined);
    if (!root || seen.has(root)) return;
    if (!isVisibleEnough(root)) return;
    if (root.className?.toString().includes('dropdown')) return;
    if (
      !findTbdSelectTrigger(root) &&
      !root.querySelector('.tbd-select-selector, .ant-select-selector')
    ) {
      return;
    }
    seen.add(root);
    roots.push(root);
  };

  if (searchInput) {
    let walker: Element | null = searchInput.parentElement;
    for (let depth = 0; depth < 8 && walker; depth += 1) {
      for (const node of walker.querySelectorAll(
        '.tbd-select, .ant-select, [class*="tbd-select-single"], [class*="ant-select-single"]',
      )) {
        push(node);
      }
      for (const sibling of walker.parentElement?.children ?? []) {
        if (!(sibling instanceof Element) || sibling === walker) continue;
        push(sibling.querySelector('.tbd-select, .ant-select') ?? sibling);
      }
      walker = walker.parentElement;
    }
  }

  for (const node of document.querySelectorAll<Element>(
    '.tbd-select, .ant-select, [class*="tbd-select-single"]',
  )) {
    const display = readTbdSelectDisplay(node);
    if (display === '全部' || display === '不限') push(node);
  }

  return roots;
}

function statusSelectPriority(display: string): number {
  if (display === '全部') return 10;
  if (display === '不限') return 9;
  if (display === '直播中') return 8;
  if (STATUS_OPTION_TEXTS.some((t) => display.includes(t))) return 5;
  return 0;
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

export function describeLiveListFilterState(
  liveRoomId: string,
  liveStatus?: C32LiveStatus,
): string {
  const input = findLiveListIdSearchInput();
  const inputValue = input ? normalizeVisibleText(input.value) : '';
  const statusSelect = findLiveListStatusSelect();
  const status = statusSelect ? readTbdSelectDisplay(statusSelect) || '(空)' : '(未找到)';
  const target = liveStatus ? `，目标状态=${liveStatus}` : '';
  return `搜索框=${inputValue || '(空)'}，状态=${status}，目标直播场次ID=${liveRoomId}${target}`;
}
