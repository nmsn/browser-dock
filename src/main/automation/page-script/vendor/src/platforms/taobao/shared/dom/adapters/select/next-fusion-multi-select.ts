import { normalizeVisibleText } from '../../../../../../shared/automation/dom-actions';
import { delay } from '../../../../../../shared/automation/delay';
import type { FieldControlAdapter } from '../types';
import type { SelectOptionAttemptResult } from './tbd-ant-select';
import {
  findMenuOptionByText,
  findNextSelectByLabel,
  findNextSelectRoot,
  findNextSelectTrigger,
  fireMenuItemClick,
  fireSelectOpen,
  isNextMultiSelectRoot,
  isNextSelectInError,
  isVisibleEnough,
  listMenuOptionLabels,
  nextSelectDisplayMatches,
  readNextSelectDisplay,
  resolveNextSelectOpenTarget,
  waitForNextSelectDropdown,
} from './next-fusion-shared';

/**
 * Fusion Design / Next Select **多选**适配器（秒杀「活动人群」等）。
 *
 * - 触发器：`.next-select-multiple`
 * - 浮层：`ul.next-select-multiple-menu`（aria-multiselectable=true）
 * - 全选：头部 `.next-select-all` / `.next-select-all-inner`（不是 role=option）
 * - 点「全选（推荐选择）」会勾选全部粉等级选项
 */

export function findNextMultiSelectRoot(scope: ParentNode): HTMLElement | undefined {
  const root = findNextSelectRoot(scope)
    ?? (scope instanceof HTMLElement && isNextMultiSelectRoot(scope) ? scope : undefined);
  if (root && isNextMultiSelectRoot(root)) return root;

  if (scope instanceof Element || scope instanceof Document) {
    const nodes = scope.querySelectorAll<HTMLElement>('.next-select-multiple, .next-select');
    for (const el of nodes) {
      if (isVisibleEnough(el) && isNextMultiSelectRoot(el)) return el;
    }
  }
  return undefined;
}

export function findNextMultiSelectByLabel(
  labels: string[],
  root?: ParentNode,
): HTMLElement | undefined {
  return findNextSelectByLabel(labels, root, { multiple: true });
}

export function findNextMultiSelectTrigger(scope: ParentNode): HTMLElement | undefined {
  const root = findNextMultiSelectRoot(scope);
  if (!root) return undefined;
  return findNextSelectTrigger(root);
}

export function readNextMultiSelectDisplay(scope: ParentNode): string {
  const root = findNextMultiSelectRoot(scope) ?? findNextSelectRoot(scope);
  return root ? readNextSelectDisplay(root) : '';
}

/**
 * 多选回读：
 * - 「全选…」：展示不再是「请选择」，通常出现粉等级 tag
 * - 其它单项：展示包含目标文案
 */
export function nextMultiSelectValueMatches(scope: ParentNode, expected: string): boolean {
  if (isNextSelectInError(scope)) return false;
  const want = normalizeVisibleText(expected);
  const display = readNextMultiSelectDisplay(scope);
  if (!display || display === '请选择' || display.includes('请选择')) return false;
  if (want.includes('全选')) {
    return display.includes('全选')
      || display.includes('粉')
      || display.includes('推荐');
  }
  return nextSelectDisplayMatches(scope, expected) || display.includes(want);
}

export async function selectNextMultiSelectOption(
  scope: ParentNode,
  optionText: string,
): Promise<boolean> {
  const result = await selectNextMultiSelectOptionDetailed(scope, optionText);
  return result.ok;
}

export async function selectNextMultiSelectOptionDetailed(
  scope: ParentNode,
  optionText: string,
): Promise<SelectOptionAttemptResult> {
  const expected = normalizeVisibleText(optionText);
  const selectRoot = findNextMultiSelectRoot(scope)
    ?? (scope instanceof HTMLElement && isNextMultiSelectRoot(scope) ? scope : undefined);
  const displayBefore = selectRoot ? readNextSelectDisplay(selectRoot) : '';

  if (!selectRoot) {
    return {
      ok: false,
      step: 'open',
      opened: false,
      optionFound: false,
      displayBefore,
      displayAfter: displayBefore,
      detail: '未找到 Fusion next-select（多选）',
    };
  }

  if (nextMultiSelectValueMatches(selectRoot, expected)) {
    return {
      ok: true,
      step: 'already',
      opened: false,
      optionFound: true,
      displayBefore,
      displayAfter: displayBefore,
      detail: 'next-select 多选已是期望值',
    };
  }

  const openTarget = resolveNextSelectOpenTarget(selectRoot);
  fireSelectOpen(openTarget);

  const picked = await openAndPickMultiOption(selectRoot, expected, 2500);
  if (!picked.opened) {
    const alt = resolveNextSelectOpenTarget(selectRoot, { preferValues: true });
    if (alt !== openTarget) {
      fireSelectOpen(alt);
      const retry = await openAndPickMultiOption(selectRoot, expected, 2500);
      if (retry.ok || retry.opened) return retry.result;
    }
    return picked.result;
  }

  return picked.result;
}

async function openAndPickMultiOption(
  root: HTMLElement,
  expected: string,
  timeoutMs: number,
): Promise<{ ok: boolean; opened: boolean; result: SelectOptionAttemptResult }> {
  const displayBefore = readNextSelectDisplay(root);
  const dropdown = await waitForNextSelectDropdown(timeoutMs, { multiple: true })
    ?? await waitForNextSelectDropdown(timeoutMs);
  if (!dropdown) {
    return {
      ok: false,
      opened: false,
      result: {
        ok: false,
        step: 'open',
        opened: false,
        optionFound: false,
        displayBefore,
        displayAfter: readNextSelectDisplay(root),
        detail: '已点击多选 next-select，但未出现 multiple listbox',
      },
    };
  }

  const option = findMultiSelectTarget(dropdown, expected);
  if (!option) {
    return {
      ok: false,
      opened: true,
      result: {
        ok: false,
        step: 'find-option',
        opened: true,
        optionFound: false,
        displayBefore,
        displayAfter: readNextSelectDisplay(root),
        detail: `多选下拉未找到「${expected}」；可选=[${listMenuOptionLabels(dropdown).join('/')}]`,
      },
    };
  }

  fireMenuItemClick(option);
  await delay('mid');

  // 多选点选后菜单常仍展开，再点触发器收起便于回读
  fireSelectOpen(resolveNextSelectOpenTarget(root));
  await delay('short');

  const displayAfter = readNextSelectDisplay(root);
  const ok = nextMultiSelectValueMatches(root, expected);
  return {
    ok,
    opened: true,
    result: {
      ok,
      step: 'apply',
      opened: true,
      optionFound: true,
      displayBefore,
      displayAfter,
      detail: ok
        ? `已选择「${expected}」`
        : `点击后展示「${displayAfter || '(空)'}」，next-error=${isNextSelectInError(root)}`,
    },
  };
}

/** 全选在 `.next-menu-header .next-select-all`；普通项在 role=option */
function findMultiSelectTarget(
  dropdown: ParentNode,
  expected: string,
): HTMLElement | undefined {
  const want = normalizeVisibleText(expected);

  if (want.includes('全选')) {
    const selectAll = findSelectAllControl(dropdown);
    if (selectAll) return selectAll;
  }

  return findMenuOptionByText(dropdown, expected);
}

function findSelectAllControl(dropdown: ParentNode): HTMLElement | undefined {
  const inner = dropdown.querySelector<HTMLElement>('.next-select-all-inner, .next-select-all');
  if (inner && isVisibleEnough(inner)) {
    return inner.closest<HTMLElement>('.next-select-all') ?? inner;
  }
  const header = dropdown.querySelector<HTMLElement>('.next-menu-header');
  if (
    header
    && normalizeVisibleText(header.textContent ?? '').includes('全选')
    && isVisibleEnough(header)
  ) {
    return header.querySelector<HTMLElement>('.next-select-all') ?? header;
  }
  return undefined;
}

export const nextFusionMultiSelectAdapter: FieldControlAdapter = {
  kind: 'select',
  match: (scope) => Boolean(findNextMultiSelectTrigger(scope) ?? findNextMultiSelectRoot(scope)),
  read: (scope) => readNextMultiSelectDisplay(scope),
  write: async (scope, value) => selectNextMultiSelectOption(scope, value),
};
