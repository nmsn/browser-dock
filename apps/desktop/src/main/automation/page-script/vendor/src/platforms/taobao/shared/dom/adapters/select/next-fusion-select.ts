import { normalizeVisibleText } from '../../../../../../shared/automation/dom-actions';
import { delay } from '../../../../../../shared/automation/delay';
import type { SelectOptionAttemptResult } from './tbd-ant-select';
import {
  findMenuOptionByText,
  findNextSelectByLabel,
  findNextSelectRoot,
  findNextSelectTrigger,
  findVisibleNextSelectDropdown,
  fireMenuItemClick,
  fireSelectOpen,
  isNextSelectInError,
  listMenuOptionLabels,
  nextSelectDisplayMatches,
  readNextSelectDisplay,
  resolveNextSelectOpenTarget,
  waitForNextSelectDropdown,
} from './next-fusion-shared';

/**
 * Fusion Design / Next Select **单选**适配器（秒杀「持续时间」等）。
 *
 * 触发器：`.next-select.next-select-trigger`
 * 展示值：`.next-select-values em` / aria-valuetext
 * 浮层：`ul.next-select-menu`（非 multiple）
 * 选项：`li.next-menu-item` → `.next-menu-item-text`
 */

export {
  findNextSelectByLabel,
  findNextSelectRoot,
  findNextSelectTrigger,
  isNextSelectInError,
  nextSelectDisplayMatches,
  readNextSelectDisplay,
} from './next-fusion-shared';

export async function selectNextSelectOption(
  scope: ParentNode,
  optionText: string,
): Promise<boolean> {
  const result = await selectNextSelectOptionDetailed(scope, optionText);
  return result.ok;
}

export async function selectNextSelectOptionDetailed(
  scope: ParentNode,
  optionText: string,
): Promise<SelectOptionAttemptResult> {
  const expected = normalizeVisibleText(optionText);
  const root = findNextSelectRoot(scope)
    ?? (scope instanceof HTMLElement ? scope : undefined);
  const displayBefore = root ? readNextSelectDisplay(root) : '';

  if (!root) {
    return {
      ok: false,
      step: 'open',
      opened: false,
      optionFound: false,
      displayBefore,
      displayAfter: displayBefore,
      detail: '未找到 Fusion next-select（单选）',
    };
  }

  if (nextSelectDisplayMatches(root, expected) && !isNextSelectInError(root)) {
    return {
      ok: true,
      step: 'already',
      opened: false,
      optionFound: true,
      displayBefore,
      displayAfter: displayBefore,
      detail: 'next-select 单选已是期望值',
    };
  }

  // 只点一次：连点箭头会把浮层关掉
  const openTarget = resolveNextSelectOpenTarget(root);
  fireSelectOpen(openTarget);

  const picked = await openAndPickSingleOption(root, expected, 2500);
  if (!picked.opened) {
    const alt = resolveNextSelectOpenTarget(root, { preferValues: true });
    if (alt !== openTarget) {
      fireSelectOpen(alt);
      const retry = await openAndPickSingleOption(root, expected, 2500);
      if (retry.ok || retry.opened) return retry.result;
    }
    return picked.result;
  }

  return picked.result;
}

async function openAndPickSingleOption(
  root: HTMLElement,
  expected: string,
  timeoutMs: number,
): Promise<{ ok: boolean; opened: boolean; result: SelectOptionAttemptResult }> {
  const displayBefore = readNextSelectDisplay(root);
  const dropdown = await waitForNextSelectDropdown(timeoutMs, { multiple: false })
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
        detail: '已点击 next-select，但未出现单选 listbox',
      },
    };
  }

  const option = findMenuOptionByText(dropdown, expected);
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
        detail: `单选下拉未找到「${expected}」；可选=[${listMenuOptionLabels(dropdown).join('/')}]`,
      },
    };
  }

  fireMenuItemClick(option);
  await delay('mid');

  // 单选一般会自己收起；若仍开着再点一次触发器
  if (findVisibleNextSelectDropdown({ multiple: false })) {
    fireSelectOpen(resolveNextSelectOpenTarget(root));
    await delay('short');
  }

  const displayAfter = readNextSelectDisplay(root);
  const ok = nextSelectDisplayMatches(root, expected) && !isNextSelectInError(root);
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
