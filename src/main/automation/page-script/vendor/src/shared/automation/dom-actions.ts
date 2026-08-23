import { delay } from './delay';
import { sleepMs } from './sleep';
import { waitUntil, WaitInterval, WaitTimeout } from './wait';

export type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

export type TextSearchOptions = WaitOptions & {
  root?: ParentNode;
  selector?: string;
  exact?: boolean;
};

const DEFAULT_TIMEOUT_MS = WaitTimeout.default;
const DEFAULT_INTERVAL_MS = WaitInterval.default;

export async function waitForElement<T extends Element = Element>(
  selector: string,
  options: WaitOptions = {},
): Promise<T> {
  return waitFor(() => document.querySelector<T>(selector), `未找到元素：${selector}`, options);
}

export async function waitForElementByText<T extends Element = Element>(
  text: string,
  options: TextSearchOptions = {},
): Promise<T> {
  const selector = options.selector ?? 'button, a, input, textarea, [role="button"], [role="tab"], [role="menuitem"], span, div';

  return waitFor(() => {
    return findElementByText<T>(text, {
      root: options.root,
      selector,
      exact: options.exact,
    });
  }, `未找到文本元素：${text}`, options);
}

export function findElementByText<T extends Element = Element>(
  text: string,
  options: Pick<TextSearchOptions, 'root' | 'selector' | 'exact'> = {},
): T | undefined {
  const root = options.root ?? document;
  const selector = options.selector ?? '*';
  const expected = normalizeVisibleText(text);

  if (!expected) return undefined;

  const elements = Array.from(root.querySelectorAll<T>(selector));
  return elements.find((element) => {
    const actual = normalizeVisibleText(getElementVisibleText(element));
    return options.exact ? actual === expected : actual.includes(expected);
  });
}

export function clickElement(element: Element) {
  element.scrollIntoView({
    block: 'center',
    inline: 'center',
  });

  const target = element instanceof HTMLElement ? element : element.parentElement;
  target?.click();
}

export type FillDateTimePickerOptions = WaitOptions & {
  root?: ParentNode;
  /** 用于点击失焦、关闭面板的 neutral 区域（如标题输入框或字段标签） */
  dismissTarget?: Element;
};

export type FillDateTimePickerResult = {
  value: string;
  valueApplied: boolean;
  panelClosed: boolean;
};

const DATE_PICKER_PANEL_SELECTORS = [
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  '.ant-picker-dropdown-visible',
  '.ant-picker-dropdown .ant-picker-time-panel',
  '.ant-picker-panel-container',
  '.el-picker-panel',
  '.el-popper.is-light[aria-hidden="false"]',
  '[class*="picker-panel"]:not([style*="display: none"])',
  '[class*="Picker-panel"]:not([style*="display: none"])',
  '[class*="date-picker-panel"]',
].join(', ');

const DATE_PICKER_CONFIRM_SELECTORS = [
  '.ant-picker-ok button',
  '.ant-picker-ok .ant-btn',
  '.ant-picker-footer .ant-btn-primary',
  '.ant-picker-footer button',
  '.el-picker-panel__footer .el-button--primary',
  '.el-date-picker__time-header + * button',
].join(', ');

export function isDatePickerPanelOpen(root: ParentNode = document): boolean {
  const panels = Array.from(root.querySelectorAll<Element>(DATE_PICKER_PANEL_SELECTORS));
  if (panels.some(isVisibleElement)) {
    return true;
  }

  // Ant Design 面板常挂到 body
  if (root !== document) {
    return isDatePickerPanelOpen(document);
  }

  return false;
}

export async function fillDateTimePicker(
  element: Element,
  value: string,
  options: FillDateTimePickerOptions = {},
): Promise<FillDateTimePickerResult> {
  const input = resolveDateTimeInput(element);
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new Error('日期时间不能为空');
  }

  clickElement(input);
  input.focus();
  await delay('tick');

  fillTextInput(input, normalizedValue);
  await delay('tick');

  dispatchKeyboard(input, 'Enter');
  await delay('short');

  // 只用真实输入值判断（勿用 placeholder：空 value 时会干扰；HH:mm 面板选完后读 value）
  let actualValue = readDateTimeInputDisplay(input);
  let valueApplied = isDateTimeValueApplied(actualValue, normalizedValue);
  const timeOnly = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(normalizedValue);

  // HH:mm 受控 TimePicker 常忽略直接赋 value，必须走面板点选；勿因短暂 DOM 值误判成功
  if (timeOnly || !valueApplied) {
    await applyDateTimeViaPickerPanel(input, normalizedValue, options);
    actualValue = readDateTimeInputDisplay(input);
    valueApplied = isDateTimeValueApplied(actualValue, normalizedValue);
  }

  if (isDatePickerPanelOpen(options.root)) {
    await clickPickerConfirmButton(options.root);
    await delay('short');
  }

  if (isDatePickerPanelOpen(options.root)) {
    dispatchKeyboard(input, 'Enter');
    await delay('tick');
  }

  if (isDatePickerPanelOpen(options.root)) {
    dispatchKeyboard(input, 'Tab');
    await delay('tick');
  }

  if (isDatePickerPanelOpen(options.root)) {
    await dismissDatePickerPanel(input, options);
    await delay('tick');
  }

  // 仍开着则再点一次确定 / 失焦
  if (isDatePickerPanelOpen(options.root)) {
    await clickPickerConfirmButton(options.root);
    await dismissDatePickerPanel(input, options);
    await delay('short');
  }

  const panelClosed = await waitForDatePickerClosed(options.timeoutMs ?? 3000, options.root);
  actualValue = readDateTimeInputDisplay(input);
  valueApplied = isDateTimeValueApplied(actualValue, normalizedValue);

  return {
    value: actualValue,
    valueApplied,
    panelClosed,
  };
}

export function fillTextInput(element: Element, value: string) {
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    throw new Error('目标元素不是可输入控件');
  }

  const maxLength = element.maxLength > 0 ? element.maxLength : undefined;
  const nextValue = maxLength ? Array.from(value).slice(0, maxLength).join('') : value;

  element.focus();
  element.click?.();

  // React/受控组件：直接 element.value= 常被忽略，需走原生 setter
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  valueSetter?.call(element, '');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  valueSetter?.call(element, nextValue);

  if (element.value !== nextValue) {
    element.value = nextValue;
  }

  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    data: nextValue,
    inputType: 'insertText',
  }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

export function selectNativeOption(element: Element, value: string) {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error('目标元素不是原生下拉控件');
  }

  const option = Array.from(element.options).find((item) => {
    return item.value === value || normalizeVisibleText(item.textContent ?? '') === normalizeVisibleText(value);
  });

  if (!option) {
    throw new Error(`未找到下拉选项：${value}`);
  }

  element.value = option.value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function waitForText(text: string, options: WaitOptions = {}): Promise<string> {
  const expected = normalizeVisibleText(text);

  return waitFor(() => {
    const bodyText = normalizeVisibleText(document.body.innerText);
    return bodyText.includes(expected) ? bodyText : undefined;
  }, `页面未出现文本：${text}`, options);
}

export function readPageFeedback(): string | undefined {
  const feedbackSelectors = [
    '[role="alert"]',
    '[class*="message"]',
    '[class*="Message"]',
    '[class*="toast"]',
    '[class*="Toast"]',
    '[class*="notice"]',
    '[class*="Notice"]',
    '[class*="error"]',
    '[class*="Error"]',
  ];

  for (const selector of feedbackSelectors) {
    const feedback = Array.from(document.querySelectorAll(selector))
      .map((element) => normalizeVisibleText(getElementVisibleText(element)))
      .find(Boolean);

    if (feedback) return feedback;
  }

  return undefined;
}

export function getElementVisibleText(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || element.placeholder || element.getAttribute('aria-label') || '';
  }

  return element.textContent || element.getAttribute('aria-label') || '';
}

export function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function waitFor<T>(
  getter: () => T | undefined | null,
  timeoutMessage: string,
  options: WaitOptions,
): Promise<T> {
  const result = await waitUntil(getter, {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
  });
  if (result !== undefined && result !== null) {
    return result;
  }
  throw new Error(timeoutMessage);
}

async function waitForDatePickerClosed(timeoutMs: number, root?: ParentNode): Promise<boolean> {
  const closed = await waitUntil(
    () => (!isDatePickerPanelOpen(root) ? true : false),
    { timeoutMs, intervalMs: 100 },
  );
  return Boolean(closed) || !isDatePickerPanelOpen(root);
}

function resolveDateTimeInput(element: Element): HTMLInputElement {
  if (element instanceof HTMLInputElement) {
    return element;
  }

  const nestedInput = element.querySelector<HTMLInputElement>('input');
  if (nestedInput) {
    return nestedInput;
  }

  throw new Error('目标元素不是日期时间输入控件');
}

/** 读取时间控件当前展示值；不用 placeholder，避免空值被当成已填写 */
function readDateTimeInputDisplay(input: HTMLInputElement): string {
  const direct = normalizeVisibleText(input.value);
  if (direct) return direct;

  const pickerRoot = input.closest('.ant-picker, .el-date-editor, [class*="picker"]');
  if (pickerRoot) {
    const fromPicker = extractTimeHHmm(normalizeVisibleText(pickerRoot.textContent ?? ''));
    if (fromPicker) return fromPicker;
  }

  return '';
}

function dispatchKeyboard(element: Element, key: string) {
  const keyCode = key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'Escape' ? 27 : 0;
  const init: KeyboardEventInit = {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  };

  element.dispatchEvent(new KeyboardEvent('keydown', init));
  element.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: keyCode }));
  element.dispatchEvent(new KeyboardEvent('keyup', init));
}

async function clickPickerConfirmButton(root?: ParentNode): Promise<boolean> {
  const searchRoots: ParentNode[] = root ? [root, document] : [document];

  for (const searchRoot of searchRoots) {
    for (const selector of DATE_PICKER_CONFIRM_SELECTORS.split(', ')) {
      const button = searchRoot.querySelector<Element>(selector);
      if (button && isVisibleElement(button)) {
        clickElement(button);
        return true;
      }
    }

    const confirmByText = findElementByText('确定', {
      root: searchRoot,
      selector: 'button, [role="button"], a, span, div',
      exact: true,
    }) ?? findElementByText('确 定', {
      root: searchRoot,
      selector: 'button, [role="button"], a, span, div',
    });

    if (confirmByText && isVisibleElement(confirmByText)) {
      clickElement(confirmByText.closest('button, [role="button"], a') ?? confirmByText);
      return true;
    }
  }

  return false;
}

async function dismissDatePickerPanel(
  input: HTMLInputElement,
  options: FillDateTimePickerOptions,
): Promise<void> {
  input.blur();

  if (options.dismissTarget) {
    clickElement(options.dismissTarget);
    return;
  }

  const root = options.root ?? document;
  const neutralTarget = findElementByText('预告名称', {
    root,
    selector: 'label, span, div, p',
  }) ?? findElementByText('预告开播时间', {
    root,
    selector: 'label, span, div, p',
  }) ?? findElementByText('添加商品', {
    root,
    selector: 'button, span, div, label',
  }) ?? findElementByText('开奖时间', {
    root,
    selector: 'label, span, div, p',
  });

  if (neutralTarget) {
    clickElement(neutralTarget);
    return;
  }

  const wrapper = input.closest('.ant-picker, .el-date-editor, [class*="picker"], [class*="Picker"]');
  if (wrapper?.parentElement) {
    clickElement(wrapper.parentElement);
  }
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function valuesLooselyMatch(actual: string, expected: string): boolean {
  const normalize = (value: string) => value.replace(/[^\d]/g, '');
  const actualDigits = normalize(actual);
  const expectedDigits = normalize(expected);

  return actualDigits.length > 0 && actualDigits === expectedDigits;
}

/** 从展示文案中抽出 HH:mm（支持夹在完整日期时间里） */
function extractTimeHHmm(value: string): string | undefined {
  const match = value.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return undefined;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isDateTimeValueApplied(actual: string, expected: string): boolean {
  const a = normalizeVisibleText(actual);
  const e = normalizeVisibleText(expected);
  // 空串绝对不能算命中：`"19:00".includes("") === true` 曾导致未写入却判成功
  if (!a || !e) return false;

  const expectedTime = extractTimeHHmm(e);
  const timeOnlyExpected = Boolean(expectedTime && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(e));
  if (timeOnlyExpected && expectedTime) {
    return extractTimeHHmm(a) === expectedTime;
  }

  if (a === e || a.includes(e)) return true;
  // 不再用 e.includes(a)：短 actual（如「00」「8:00」）会误命中「19:00」「18:00」
  return valuesLooselyMatch(a, e);
}

async function applyDateTimeViaPickerPanel(
  input: HTMLInputElement,
  value: string,
  options: FillDateTimePickerOptions,
): Promise<boolean> {
  if (!isDatePickerPanelOpen(options.root)) {
    clickElement(input);
    input.focus();
    await sleepMs(120);
  }

  if (!isDatePickerPanelOpen(options.root)) {
    return false;
  }

  const timeOnly = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (timeOnly) {
    return selectTimeInAntPickerPanel(timeOnly[1], timeOnly[2], options.root);
  }

  return false;
}

function findOpenAntPickerDropdown(root?: ParentNode): Element | undefined {
  const searchRoots: ParentNode[] = root && root !== document ? [root, document] : [document];

  for (const searchRoot of searchRoots) {
    const dropdowns = searchRoot.querySelectorAll('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)');
    const visible = Array.from(dropdowns).find(isVisibleElement);
    if (visible) return visible;
  }

  return undefined;
}

async function selectTimeInAntPickerPanel(
  hour: string,
  minute: string,
  root?: ParentNode,
): Promise<boolean> {
  const dropdown = findOpenAntPickerDropdown(root);
  if (!dropdown) return false;

  const columns = dropdown.querySelectorAll('.ant-picker-time-panel-column');
  if (columns.length < 2) return false;

  const hourOk = clickTimePanelCell(columns[0], hour);
  await sleepMs(80);
  const minuteOk = clickTimePanelCell(columns[1], minute);
  if (!(hourOk && minuteOk)) return false;

  // Ant Design 时间面板选完列后需点「确定」才会收起并提交
  await sleepMs(80);
  await clickPickerConfirmButton(root);
  return true;
}

function clickTimePanelCell(column: Element, value: string): boolean {
  const padded = value.padStart(2, '0');
  const unpadded = String(parseInt(value, 10));

  for (const cell of column.querySelectorAll('.ant-picker-time-panel-cell')) {
    const inner = cell.querySelector('.ant-picker-time-panel-cell-inner');
    const text = normalizeVisibleText(inner?.textContent ?? '');
    if (text !== padded && text !== unpadded && text !== value) continue;

    const target = inner ?? cell;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    clickElement(target);
    return true;
  }

  return false;
}
