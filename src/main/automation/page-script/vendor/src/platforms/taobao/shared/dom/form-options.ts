import {
  clickElement,
  findElementByText,
  getElementVisibleText,
  normalizeVisibleText,
} from '../../../../shared/automation/dom-actions';
import { findClickableByText, findInputInField } from './finders';
import {
  findNextMultiSelectByLabel,
  findNextMultiSelectRoot,
  findNextSelectByLabel,
  findNextSelectRoot,
  findNextSelectTrigger,
  findTbdSelectRoot,
  findTbdSelectTrigger,
  nextMultiSelectValueMatches,
  nextSelectDisplayMatches,
  readNextMultiSelectDisplay,
  readNextSelectDisplay,
  readTbdSelectDisplay,
  selectNextMultiSelectOptionDetailed,
  selectNextSelectOptionDetailed,
  selectTbdSelectOptionDetailed,
  tbdSelectDisplayMatches,
  type SelectOptionAttemptResult,
} from './adapters';
import { delay } from '../../../../shared/automation/delay';

const FORM_ITEM_SELECTOR = [
  '.tbd-form-item',
  '[class*="tbd-form-item"]',
  '[class*="form-item"]',
  '[class*="FormItem"]',
  '[class*="formItem"]',
  '[class*="formItemWrapper"]',
  '[class*="form-field"]',
  '[class*="FormField"]',
  '[class*="form-row"]',
  '[class*="FormRow"]',
  '[class*="field-item"]',
  '[class*="FieldItem"]',
].join(', ');

const FIELD_CONTROL_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '.tbd-select',
  '[class*="tbd-select"]',
  '[class*="select"]',
  '[class*="Select"]',
  '[class*="checkbox"]',
  '[class*="Checkbox"]',
  '[class*="radio"]',
  '[class*="Radio"]',
].join(', ');

function findFieldLabel(labelText: string, root: ParentNode): Element | undefined {
  return findElementByText(labelText, {
    root,
    selector: 'label, span, div, p',
    exact: true,
  }) ?? findElementByText(labelText, {
    root,
    selector: 'label, span, div, p',
  });
}

/**
 * 定位字段容器：优先 form-item 类名；否则向上找到「含控件且文案不太长」的祖先。
 */
function findFieldRoot(labelText: string, root?: ParentNode): Element | undefined {
  const searchRoot = root ?? document;
  const label = findFieldLabel(labelText, searchRoot);
  if (!label) return undefined;

  const byClass = label.closest(FORM_ITEM_SELECTOR);
  if (byClass && byClass.querySelector(FIELD_CONTROL_SELECTOR)) {
    return byClass;
  }

  let best: Element | undefined;
  let current: Element | null = label.parentElement;
  for (let depth = 0; depth < 12 && current; depth += 1) {
    if (!(current instanceof HTMLElement)) {
      current = current.parentElement;
      continue;
    }
    if (!current.querySelector(FIELD_CONTROL_SELECTOR)) {
      current = current.parentElement;
      continue;
    }

    const textLen = normalizeVisibleText(current.textContent ?? '').length;
    if (textLen > 0 && textLen < 600) {
      best = current;
    } else if (textLen >= 600) {
      break;
    }
    current = current.parentElement;
  }

  return best ?? byClass ?? label.parentElement ?? undefined;
}

function resolveFieldScope(
  fieldLabels: string[],
  root?: ParentNode,
): ParentNode {
  const searchRoot = root ?? document;
  for (const label of fieldLabels) {
    const found = findFieldRoot(label, searchRoot);
    if (found) return found;
  }
  return searchRoot;
}

function isOptionSelected(element: Element): boolean {
  if (element instanceof HTMLInputElement) {
    return element.checked;
  }

  const ariaChecked = element.getAttribute('aria-checked');
  if (ariaChecked === 'true') return true;
  if (ariaChecked === 'false') return false;

  const control = element.querySelector<HTMLInputElement>('input[type="checkbox"], input[type="radio"]');
  if (control) return control.checked;

  const className = element.className?.toString() ?? '';
  return /(?:^|[\s_-])(?:is-checked|checked|is-selected)(?:$|[\s_-])/i.test(className)
    || /ant-checkbox-wrapper-checked|ant-radio-wrapper-checked|next-checked|next-selected/i.test(className);
}

function findCheckboxLikeControl(optionEl: Element): Element {
  const withInput = optionEl.closest('label')
    ?? optionEl.closest('[role="checkbox"], [role="radio"], [role="switch"]')
    ?? optionEl.closest('[class*="checkbox"], [class*="Checkbox"], [class*="radio"], [class*="Radio"]');
  if (withInput) return withInput;

  const nested = optionEl.querySelector(
    'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]',
  );
  if (nested) return nested.closest('label') ?? nested;

  return optionEl;
}

/**
 * 在表单字段附近勾选指定文案（checkbox / radio）。
 */
export function toggleCheckboxNearLabel(
  fieldLabels: string[],
  optionText: string,
  enabled: boolean,
  root?: ParentNode,
): boolean {
  const state = readCheckboxNearLabel(fieldLabels, optionText, root);
  if (state === undefined) return false;
  if (state === enabled) return true;

  const clickTarget = findCheckboxControl(fieldLabels, optionText, root);
  if (!clickTarget) return false;

  clickElement(clickTarget);
  if (isOptionSelected(clickTarget) === enabled) return true;

  const input = clickTarget.querySelector<HTMLInputElement>('input[type="checkbox"], input[type="radio"]')
    ?? (clickTarget instanceof HTMLInputElement ? clickTarget : null);
  if (input) {
    clickElement(input);
  } else {
    clickElement(clickTarget);
  }

  return isOptionSelected(clickTarget) === enabled;
}

/** 回读勾选态；找不到控件返回 undefined */
export function readCheckboxNearLabel(
  fieldLabels: string[],
  optionText: string,
  root?: ParentNode,
): boolean | undefined {
  const clickTarget = findCheckboxControl(fieldLabels, optionText, root);
  if (!clickTarget) return undefined;
  return isOptionSelected(clickTarget);
}

function findCheckboxControl(
  fieldLabels: string[],
  optionText: string,
  root?: ParentNode,
): Element | undefined {
  const searchRoot = root ?? document;
  const fieldRoot = resolveFieldScope(fieldLabels, searchRoot);

  const option = optionText
    ? findOptionTextElement(optionText, fieldRoot) ?? findOptionTextElement(optionText, searchRoot)
    : findFieldRoot(fieldLabels[0], searchRoot);

  if (!option) return undefined;
  return findCheckboxLikeControl(option);
}

function findOptionTextElement(optionText: string, root: ParentNode): Element | undefined {
  return findElementByText(optionText, {
    root,
    selector: 'label, span, div, p, [role="checkbox"], [role="radio"]',
    exact: true,
  }) ?? findElementByText(optionText, {
    root,
    selector: 'label, span, div, [role="checkbox"], [role="radio"]',
  });
}

/**
 * 选择下拉/内联选项。
 * - 识别到 TBD/Ant Select 时走适配器（点展示框 → 等浮层 → 点选项）
 * - 否则尝试内联 radio / 文案点击兜底
 */
export async function selectOptionNearLabel(
  fieldLabels: string[],
  optionText: string,
  root?: ParentNode,
): Promise<boolean> {
  const result = await selectOptionNearLabelDetailed(fieldLabels, optionText, root);
  return result.ok;
}

/** 带步骤诊断的选择结果，供 verified-inputs 报错 */
export async function selectOptionNearLabelDetailed(
  fieldLabels: string[],
  optionText: string,
  root?: ParentNode,
): Promise<SelectOptionAttemptResult> {
  const scope = resolveFieldScope(fieldLabels, root);
  const expected = normalizeVisibleText(optionText);
  const displayBefore = readSelectDisplayNearLabel(fieldLabels, root);

  if (optionMatchesNearLabel(fieldLabels, expected, root)) {
    return {
      ok: true,
      step: 'already',
      opened: false,
      optionFound: true,
      displayBefore,
      displayAfter: displayBefore,
      detail: '已是期望值，跳过',
    };
  }

  // TBD / Ant Design Select（直播间类型等）
  if (findTbdSelectTrigger(scope) || findTbdSelectRoot(scope)) {
    return selectTbdSelectOptionDetailed(scope, expected);
  }

  // Fusion next-select 多选（活动人群等）——优先于单选
  const nextMulti = findNextMultiSelectRoot(scope)
    ?? findNextMultiSelectByLabel(fieldLabels, root);
  if (nextMulti) {
    return selectNextMultiSelectOptionDetailed(nextMulti, expected);
  }

  // Fusion next-select 单选（持续时间等）
  const nextRoot = findNextSelectRoot(scope)
    ?? findNextSelectByLabel(fieldLabels, root, { multiple: false })
    ?? findNextSelectTrigger(scope);
  if (nextRoot) {
    return selectNextSelectOptionDetailed(nextRoot, expected);
  }

  // 内联 radio / checkbox
  const inline = findOptionTextElement(optionText, scope);
  if (inline && isLikelyInlineChoice(inline, scope instanceof Element ? scope : undefined)) {
    const clickTarget = findCheckboxLikeControl(inline);
    if (!isOptionSelected(clickTarget)) {
      clickElement(clickTarget);
    }
    await delay('short');
    const displayAfter = readSelectDisplayNearLabel(fieldLabels, root);
    const ok = optionMatchesNearLabel(fieldLabels, expected, root);
    return {
      ok,
      step: 'apply',
      opened: false,
      optionFound: true,
      displayBefore,
      displayAfter,
      detail: ok ? '内联选项已点选' : '内联选项点击后未匹配',
    };
  }

  // 兜底：直接点文案
  const fallback = findClickableByText(optionText, scope) ?? findOptionTextElement(optionText, scope);
  if (!fallback) {
    return {
      ok: false,
      step: 'find-option',
      opened: false,
      optionFound: false,
      displayBefore,
      displayAfter: displayBefore,
      detail: '未找到可点选项',
    };
  }
  clickElement(fallback);
  await delay('short');
  const displayAfter = readSelectDisplayNearLabel(fieldLabels, root);
  const ok = optionMatchesNearLabel(fieldLabels, expected, root);
  return {
    ok,
    step: 'apply',
    opened: false,
    optionFound: true,
    displayBefore,
    displayAfter,
    detail: ok ? '文案兜底点击成功' : '文案兜底点击后未匹配',
  };
}

/** 回读下拉当前展示文案（用于校验与错误信息） */
export function readSelectDisplayNearLabel(
  fieldLabels: string[],
  root?: ParentNode,
): string {
  const scope = resolveFieldScope(fieldLabels, root);
  if (findTbdSelectRoot(scope) || findTbdSelectTrigger(scope)) {
    return readTbdSelectDisplay(scope);
  }
  const nextMulti = findNextMultiSelectRoot(scope)
    ?? findNextMultiSelectByLabel(fieldLabels, root);
  if (nextMulti) {
    return readNextMultiSelectDisplay(nextMulti);
  }
  const nextRoot = findNextSelectRoot(scope)
    ?? findNextSelectByLabel(fieldLabels, root, { multiple: false })
    ?? findNextSelectTrigger(scope);
  if (nextRoot) {
    return readNextSelectDisplay(nextRoot);
  }
  return normalizeVisibleText(
    scope instanceof Element ? getElementVisibleText(scope) : '',
  );
}

/** 回读下拉/选项当前展示是否匹配期望文案 */
export function optionMatchesNearLabel(
  fieldLabels: string[],
  optionText: string,
  root?: ParentNode,
): boolean {
  const expected = normalizeVisibleText(optionText);
  const scope = resolveFieldScope(fieldLabels, root);

  if (findTbdSelectRoot(scope) || findTbdSelectTrigger(scope)) {
    if (tbdSelectDisplayMatches(scope, expected)) return true;
  }

  const nextMulti = findNextMultiSelectRoot(scope)
    ?? findNextMultiSelectByLabel(fieldLabels, root);
  if (nextMulti && nextMultiSelectValueMatches(nextMulti, expected)) {
    return true;
  }

  const nextRoot = findNextSelectRoot(scope)
    ?? findNextSelectByLabel(fieldLabels, root, { multiple: false })
    ?? findNextSelectTrigger(scope);
  if (nextRoot && nextSelectDisplayMatches(nextRoot, expected)) {
    return true;
  }

  const display = readSelectDisplayNearLabel(fieldLabels, root);
  if (display && (display === expected || display.split(/\s+/).includes(expected))) {
    return true;
  }

  const checkboxState = readCheckboxNearLabel(fieldLabels, optionText, root);
  return checkboxState === true;
}

function isLikelyInlineChoice(element: Element, fieldRoot?: Element): boolean {
  if (element.closest('[role="listbox"], [class*="dropdown"], [class*="Dropdown"], [class*="select-menu"], [class*="menu-item"], [class*="MenuItem"], [class*="overlay"], [class*="Overlay"]')) {
    return false;
  }
  if (element.matches('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]')) {
    return true;
  }
  if (element.closest('label')?.querySelector('input[type="checkbox"], input[type="radio"]')) {
    return true;
  }
  if (fieldRoot && !findTbdSelectTrigger(fieldRoot)) {
    const text = normalizeVisibleText(getElementVisibleText(element));
    return text.length > 0 && text.length <= 12;
  }
  return false;
}

export function fillExtraTextNearLabel(
  fieldLabels: string[],
  value: string,
  root?: ParentNode,
): boolean {
  const input = findInputInField(fieldLabels, root);
  if (!input) return false;

  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function normalizeVisibleOptionText(value: string): string {
  return normalizeVisibleText(value);
}
