export {
  findTbdSelectRoot,
  findTbdSelectTrigger,
  isTbdOrAntSelectRoot,
  readTbdSelectDisplay,
  selectTbdSelectOption,
  selectTbdSelectOptionDetailed,
  tbdSelectDisplayMatches,
  type SelectOptionAttemptResult,
} from './tbd-ant-select';

export {
  findNextSelectByLabel,
  findNextSelectRoot,
  findNextSelectTrigger,
  findSelectAmongNextSiblings,
  fireSelectOpen,
  isNextMultiSelectRoot,
  isNextSelectInError,
  nextSelectDisplayMatches,
  readNextSelectDisplay,
} from './next-fusion-shared';

export {
  selectNextSelectOption,
  selectNextSelectOptionDetailed,
} from './next-fusion-select';

export {
  findNextMultiSelectByLabel,
  findNextMultiSelectRoot,
  findNextMultiSelectTrigger,
  nextFusionMultiSelectAdapter,
  nextMultiSelectValueMatches,
  readNextMultiSelectDisplay,
  selectNextMultiSelectOption,
  selectNextMultiSelectOptionDetailed,
} from './next-fusion-multi-select';

import type { FieldControlAdapter } from '../types';
import {
  findTbdSelectTrigger,
  readTbdSelectDisplay,
  selectTbdSelectOption,
  tbdSelectDisplayMatches,
} from './tbd-ant-select';
import {
  findNextSelectTrigger,
  nextSelectDisplayMatches,
  readNextSelectDisplay,
} from './next-fusion-shared';
import { selectNextSelectOption } from './next-fusion-select';
import {
  findNextMultiSelectTrigger,
  nextMultiSelectValueMatches,
  readNextMultiSelectDisplay,
  selectNextMultiSelectOption,
} from './next-fusion-multi-select';

/** TBD / Ant Design Select */
export const tbdAntSelectAdapter: FieldControlAdapter = {
  kind: 'select',
  match: (scope) => Boolean(findTbdSelectTrigger(scope)),
  read: (scope) => readTbdSelectDisplay(scope),
  write: async (scope, value) => selectTbdSelectOption(scope, value),
};

/** Fusion next-select 单选 */
export const nextFusionSelectAdapter: FieldControlAdapter = {
  kind: 'select',
  match: (scope) => {
    const trigger = findNextSelectTrigger(scope);
    if (!trigger) return false;
    // 多选交给 multi 适配器
    const root = trigger.closest('.next-select') ?? trigger;
    return !/\bnext-select-multiple\b/.test(root.className?.toString?.() ?? '');
  },
  read: (scope) => readNextSelectDisplay(scope),
  write: async (scope, value) => selectNextSelectOption(scope, value),
};

export function selectDisplayMatches(scope: ParentNode, expected: string): boolean {
  if (findTbdSelectTrigger(scope)) {
    return tbdSelectDisplayMatches(scope, expected);
  }
  if (findNextMultiSelectTrigger(scope)) {
    return nextMultiSelectValueMatches(scope, expected);
  }
  if (findNextSelectTrigger(scope)) {
    return nextSelectDisplayMatches(scope, expected);
  }
  return false;
}

/** @deprecated 使用 nextMultiSelectValueMatches；保留别名兼容旧调用 */
export function nextSelectValueMatches(scope: ParentNode, expected: string): boolean {
  if (findNextMultiSelectTrigger(scope)) {
    return nextMultiSelectValueMatches(scope, expected);
  }
  return nextSelectDisplayMatches(scope, expected);
}
