/**
 * 淘宝表单控件适配器统一出口。
 *
 * 目录约定见 docs/superpowers/specs/2026-07-28-form-adapters-directory-design.md
 * - select/      TBD/Ant Select + Fusion next-select（单选/多选）
 * - cascader/    Fusion CascaderSelect / Ant Cascader（路径多级）
 * - checkbox/    预留
 * - date-picker/ 预留
 * - upload/      预留
 * - text-input/  预留
 */

export type { AdapterKind, FieldControlAdapter } from './types';

export {
  findNextMultiSelectByLabel,
  findNextMultiSelectRoot,
  findNextMultiSelectTrigger,
  findNextSelectByLabel,
  findNextSelectRoot,
  findNextSelectTrigger,
  findTbdSelectRoot,
  findTbdSelectTrigger,
  isNextMultiSelectRoot,
  isNextSelectInError,
  isTbdOrAntSelectRoot,
  nextFusionMultiSelectAdapter,
  nextFusionSelectAdapter,
  nextMultiSelectValueMatches,
  nextSelectDisplayMatches,
  nextSelectValueMatches,
  readNextMultiSelectDisplay,
  readNextSelectDisplay,
  readTbdSelectDisplay,
  selectDisplayMatches,
  selectNextMultiSelectOption,
  selectNextMultiSelectOptionDetailed,
  selectNextSelectOption,
  selectNextSelectOptionDetailed,
  selectTbdSelectOption,
  selectTbdSelectOptionDetailed,
  tbdAntSelectAdapter,
  tbdSelectDisplayMatches,
} from './select';

export type { SelectOptionAttemptResult } from './select';

export {
  findCascaderField,
  isCascaderPathSelected,
  readCascaderDisplay,
  selectCascaderPathNearLabel,
} from './cascader';

export type { SelectCascaderPathResult } from './cascader';

export {
  parseDateTimeValue,
  selectDateTimeInPickerPanel,
} from './date-picker';

export type { DateTimePanelSelectResult, ParsedDateTime } from './date-picker';
