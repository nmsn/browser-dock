import {
  clickElement,
  getElementVisibleText,
  normalizeVisibleText,
} from '../../../../../../shared/automation/dom-actions';
import { delay } from '../../../../../../shared/automation/delay';
import { waitUntil } from '../../../../../../shared/automation/wait';

/**
 * TBD / Ant Design / TBLA Select 适配器。
 *
 * 人工同款三步：
 * 1. 点击展示框 `.tbd-select-selector` / `.tbla-select-selector`
 * 2. 等待 body 浮层 `.tbd-select-dropdown` / `.tbla-select-dropdown`
 * 3. 在浮层内点击目标选项
 * 4. 回读 `.tbd-select-selection-item` / `.tbla-select-selection-item`
 *
 * 「直播间类型」可见项在 `.rc-virtual-list .tbd-select-item-option[title]`（纵向），
 * 隐藏 0×0 listbox 的 role=option 不可点；失败时再按坐标 / 键盘兜底。
 * C32 口袋商品搜索维度为 `.tbla-select.search-select--*`（商品标题 / 商品ID）。
 */

const SELECT_ROOT_SELECTOR = [
  '.tbd-select',
  '[class*="tbd-select"]:not([class*="dropdown"]):not([class*="item"])',
  '.tbla-select',
  '[class*="tbla-select"]:not([class*="dropdown"]):not([class*="item"]):not([class*="selector"]):not([class*="selection"]):not([class*="arrow"]):not([class*="suffix"])',
  '.ant-select',
  '[class*="ant-select"]:not([class*="dropdown"]):not([class*="item"])',
].join(',');

const SELECTOR_TRIGGER_SELECTOR = [
  '.tbd-select-selector',
  '[class*="tbd-select-selector"]',
  '.tbla-select-selector',
  '[class*="tbla-select-selector"]',
  '.ant-select-selector',
  '[class*="select-selector"]',
].join(',');

const SELECTION_ITEM_SELECTOR = [
  '.tbd-select-selection-item',
  '[class*="tbd-select-selection-item"]',
  '.tbla-select-selection-item',
  '[class*="tbla-select-selection-item"]',
  '.ant-select-selection-item',
  '[class*="select-selection-item"]',
].join(',');

const DROPDOWN_SELECTOR = [
  '.tbd-select-dropdown',
  '.tle-dropdown-common-style',
  '[class*="tbd-select-dropdown-placement"]',
  '.tbla-select-dropdown',
  '[class*="tbla-select-dropdown"]',
  '.ant-select-dropdown',
].join(',');

export type SelectOptionAttemptResult = {
  ok: boolean;
  step: 'already' | 'open' | 'find-option' | 'apply';
  opened: boolean;
  optionFound: boolean;
  displayBefore: string;
  displayAfter: string;
  detail: string;
};

export function isTbdOrAntSelectRoot(element: Element): boolean {
  return Boolean(
    element.closest(SELECT_ROOT_SELECTOR)
    || element.matches?.(SELECT_ROOT_SELECTOR)
    || element.querySelector?.(SELECTOR_TRIGGER_SELECTOR),
  );
}

export function findTbdSelectRoot(scope: ParentNode): Element | undefined {
  if (scope instanceof Element) {
    if (scope.matches(SELECT_ROOT_SELECTOR) && isVisibleEnough(scope)) return scope;
    const nested = scope.querySelector<Element>(SELECT_ROOT_SELECTOR);
    if (nested && isVisibleEnough(nested)) return nested;
    const byLog = scope.querySelector<Element>(
      '[data-tblalog-d="room-type__card"], [data-tblalog-d*="room-type"]',
    );
    if (byLog) {
      const select = byLog.closest(SELECT_ROOT_SELECTOR)
        ?? byLog.querySelector(SELECT_ROOT_SELECTOR)
        ?? byLog;
      if (isVisibleEnough(select)) return select;
    }
  } else if (scope instanceof Document) {
    const nested = scope.querySelector<Element>(SELECT_ROOT_SELECTOR);
    if (nested && isVisibleEnough(nested)) return nested;
  }
  return undefined;
}

export function findTbdSelectTrigger(scope: ParentNode): Element | undefined {
  const root = findTbdSelectRoot(scope) ?? (scope instanceof Element ? scope : undefined);
  const searchIn: ParentNode = root ?? scope;
  const selector = queryFirstVisible(searchIn, SELECTOR_TRIGGER_SELECTOR);
  if (selector) return selector;

  const item = queryFirstVisible(searchIn, SELECTION_ITEM_SELECTOR);
  if (item) {
    return item.closest(SELECTOR_TRIGGER_SELECTOR)
      ?? item.closest(SELECT_ROOT_SELECTOR)
      ?? item;
  }
  return root && isVisibleEnough(root) ? root : undefined;
}

export function readTbdSelectDisplay(scope: ParentNode): string {
  const root = findTbdSelectRoot(scope) ?? (scope instanceof Element ? scope : undefined);
  const searchIn: ParentNode = root ?? scope;
  const item = queryFirstVisible(searchIn, SELECTION_ITEM_SELECTOR);
  if (item) {
    const titled = item.getAttribute('title')?.trim();
    if (titled) return normalizeVisibleText(titled);
    const text = normalizeVisibleText(getElementVisibleText(item));
    if (text) return text;
  }
  return '';
}

export function tbdSelectDisplayMatches(scope: ParentNode, expected: string): boolean {
  const actual = readTbdSelectDisplay(scope);
  const want = normalizeVisibleText(expected);
  if (!actual || !want) return false;
  return actual === want || actual.split(/\s+/).includes(want);
}

export async function selectTbdSelectOption(
  scope: ParentNode,
  optionText: string,
): Promise<boolean> {
  const result = await selectTbdSelectOptionDetailed(scope, optionText);
  return result.ok;
}

/**
 * 点展示框 → 等浮层 → 点选项 → 回读。
 */
export async function selectTbdSelectOptionDetailed(
  scope: ParentNode,
  optionText: string,
): Promise<SelectOptionAttemptResult> {
  const expected = normalizeVisibleText(optionText);
  const displayBefore = readTbdSelectDisplay(scope);

  if (!expected) {
    return failResult('apply', displayBefore, displayBefore, false, false, '期望值为空');
  }

  if (tbdSelectDisplayMatches(scope, expected)) {
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

  const root = findTbdSelectRoot(scope);
  const trigger = findTbdSelectTrigger(scope);
  if (!root || !trigger) {
    return failResult(
      'open',
      displayBefore,
      displayBefore,
      false,
      false,
      '未找到 Select 展示框（.tbd-select-selector）',
    );
  }

  // —— 1. 点击展示框 ——
  await openSelectDropdown(root, trigger);

  // —— 2. 等待浮层 ——
  const dropdown = await waitForLinkedDropdown(root, 4500);
  if (!dropdown) {
    return failResult(
      'open',
      displayBefore,
      readTbdSelectDisplay(scope),
      false,
      false,
      '已点展示框，但未出现 .tbd-select-dropdown 浮层',
    );
  }

  // —— 3. 点选项（文案 → 坐标 → 键盘）——
  const strategies: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: '虚拟列表 option',
      run: async () => {
        const target = findOptionClickTarget(dropdown, expected);
        if (!target) throw new Error('no-text-target');
        // rc-select 在 option 的 mousedown 上选中；必须打在可见 .tbd-select-item-option 上
        fireRcSelectOptionMouseDown(target);
      },
    },
    {
      name: '列表坐标',
      run: async () => {
        clickRoomTypeCardByPosition(dropdown, expected);
      },
    },
    {
      name: '键盘方向键',
      run: async () => {
        await selectByKeyboard(root, expected, displayBefore);
      },
    },
  ];

  for (const strategy of strategies) {
    try {
      await strategy.run();
    } catch {
      continue;
    }
    await delay('short');
    if (await waitUntil(
      () => (tbdSelectDisplayMatches(scope, expected) ? true : undefined),
      { timeoutMs: 1800, intervalMs: 120 },
    )) {
      return {
        ok: true,
        step: 'apply',
        opened: true,
        optionFound: true,
        displayBefore,
        displayAfter: readTbdSelectDisplay(scope),
        detail: `已通过「${strategy.name}」选中`,
      };
    }
    // 值未变则确保浮层仍开着，再试下一策略
    if (!findLinkedDropdown(root)) {
      await openSelectDropdown(root, trigger);
      const reopened = await waitForLinkedDropdown(root, 2500);
      if (!reopened) break;
    }
  }

  const displayAfter = readTbdSelectDisplay(scope);
  closeDropdown(root);
  return failResult(
    'apply',
    displayBefore,
    displayAfter,
    true,
    true,
    `浮层已出现并尝试点选，展示值仍为「${displayAfter || '空'}」`,
  );
}

function failResult(
  step: SelectOptionAttemptResult['step'],
  displayBefore: string,
  displayAfter: string,
  opened: boolean,
  optionFound: boolean,
  detail: string,
): SelectOptionAttemptResult {
  return {
    ok: false,
    step,
    opened,
    optionFound,
    displayBefore,
    displayAfter,
    detail,
  };
}

async function openSelectDropdown(root: Element, trigger: Element): Promise<void> {
  if (trigger instanceof HTMLElement) {
    trigger.scrollIntoView({ block: 'center', inline: 'center' });
  }
  await delay('tick');

  // rc-select 通常在 selector 的 mousedown 时打开
  clickAtElementCenter(trigger);
  await delay('mid');
  if (findLinkedDropdown(root)) return;

  const arrow = root.querySelector<HTMLElement>(
    '.tbd-select-arrow, [class*="select-arrow"], .tbd-select-suffix',
  );
  if (arrow) {
    clickAtElementCenter(arrow);
    await delay('mid');
    if (findLinkedDropdown(root)) return;
  }

  clickElement(trigger);
  await delay('mid');
}

function findLinkedDropdown(root: Element): Element | undefined {
  const input = root.querySelector<HTMLInputElement>(
    'input[role="combobox"], input[class*="selection-search-input"]',
  );
  const listId = input?.getAttribute('aria-controls')
    || input?.getAttribute('aria-owns')
    || undefined;

  if (listId) {
    const byId = document.getElementById(listId);
    if (byId) {
      const dropdown = byId.closest(DROPDOWN_SELECTOR) ?? byId;
      if (isOpenDropdown(dropdown)) return dropdown;
    }
  }

  return findVisibleRoomTypeDropdown();
}

async function waitForLinkedDropdown(root: Element, timeoutMs: number): Promise<Element | undefined> {
  return waitUntil(() => findLinkedDropdown(root), { timeoutMs, intervalMs: 120 });
}

function findVisibleRoomTypeDropdown(): Element | undefined {
  const candidates = Array.from(document.querySelectorAll<Element>(DROPDOWN_SELECTOR));
  return candidates.find((el) => {
    if (!isOpenDropdown(el)) return false;
    const text = normalizeVisibleText(el.textContent ?? '');
    return text.includes('横屏') || text.includes('竖屏') || text.length > 0;
  });
}

function isOpenDropdown(el: Element): boolean {
  if (!isVisibleEnough(el)) return false;
  const className = el.className?.toString() ?? '';
  if (className.includes('dropdown-hidden') || className.includes('select-dropdown-hidden')) {
    return false;
  }
  return true;
}

/**
 * 实页结构（用户采集）：
 * - 隐藏 a11y listbox：`role="listbox"` 且 0×0，内含 role=option（不可点）
 * - 可见项：`.rc-virtual-list` → `.tbd-select-item-option[title="横屏|竖屏"]`
 * - holder-inner 为 `flex-direction: column`（上竖屏 / 下横屏）
 */
function findOptionClickTarget(dropdown: Element, expected: string): Element | undefined {
  const want = normalizeVisibleText(expected);

  // 1) 可见虚拟列表项（最可靠）
  const visibleItems = Array.from(
    dropdown.querySelectorAll<Element>(
      '.rc-virtual-list .tbd-select-item-option, .tbd-select-item.tbd-select-item-option, .tbla-select-item.tbla-select-item-option, .tbla-select-item-option, .ant-select-item-option',
    ),
  );
  for (const el of visibleItems) {
    if (!isVisibleEnough(el)) continue;
    if (isInsideZeroSizeListbox(el)) continue;
    const title = normalizeVisibleText(el.getAttribute('title') ?? '');
    const text = normalizeVisibleText(el.textContent ?? '');
    if (title === want || labelIncludesOnly(text, want)) {
      return el;
    }
  }

  // 2) title 精确匹配任意可见节点
  const byTitle = Array.from(dropdown.querySelectorAll<Element>(`[title="${cssEscape(want)}"]`));
  for (const el of byTitle) {
    if (!isVisibleEnough(el) || isInsideZeroSizeListbox(el)) continue;
    return el.closest('.tbd-select-item-option, .tbla-select-item-option, .ant-select-item-option') ?? el;
  }

  // 3) 勿点隐藏 listbox 里的 role=option；仅作最后兜底且必须可见
  const roleOptions = Array.from(dropdown.querySelectorAll<Element>('[role="option"]'));
  for (const el of roleOptions) {
    if (!isVisibleEnough(el) || isInsideZeroSizeListbox(el)) continue;
    const label = normalizeVisibleText(
      el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '',
    );
    if (labelIncludesOnly(label, want)) return el;
  }

  return undefined;
}

function isInsideZeroSizeListbox(el: Element): boolean {
  const listbox = el.closest('[role="listbox"]');
  if (!listbox || !(listbox instanceof HTMLElement)) return false;
  const rect = listbox.getBoundingClientRect();
  return rect.width < 2 || rect.height < 2;
}

function labelIncludesOnly(label: string, expected: string): boolean {
  if (label === expected) return true;
  if (!label.includes(expected)) return false;
  if (label.includes('横屏') && label.includes('竖屏')) return false;
  const stripped = label.replace(new RegExp(expected, 'g'), '').replace(/\s+/g, '');
  return stripped.length === 0;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * 坐标兜底：column 布局点上下，row 布局点左右。
 * 竖屏在前 → 上/左；横屏在后 → 下/右。
 */
function clickRoomTypeCardByPosition(dropdown: Element, expected: string): void {
  const want = normalizeVisibleText(expected);
  const rect = dropdown.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) {
    throw new Error('dropdown-too-small');
  }

  const holderInner = dropdown.querySelector<HTMLElement>('.rc-virtual-list-holder-inner');
  const style = holderInner ? window.getComputedStyle(holderInner) : undefined;
  const isColumn = !style || style.flexDirection.includes('column') || rect.height >= rect.width * 0.2;

  // 文案顺序：先出现的在上/左
  const text = normalizeVisibleText(dropdown.textContent ?? '');
  const hengFirst = text.indexOf('横屏');
  const shuFirst = text.indexOf('竖屏');
  const expectedIsFirst = hengFirst >= 0 && shuFirst >= 0
    ? (want === '横屏' ? hengFirst < shuFirst : shuFirst < hengFirst)
    : want === '竖屏';

  let clientX = rect.left + rect.width * 0.5;
  let clientY = rect.top + rect.height * 0.5;
  if (isColumn) {
    clientY = rect.top + rect.height * (expectedIsFirst ? 0.28 : 0.72);
  } else {
    clientX = rect.left + rect.width * (expectedIsFirst ? 0.28 : 0.72);
  }

  // 优先命中可见 option；否则按坐标
  const option = findOptionClickTarget(dropdown, want);
  if (option) {
    fireRcSelectOptionMouseDown(option);
    return;
  }
  clickAtPoint(clientX, clientY);
}

async function selectByKeyboard(
  root: Element,
  expected: string,
  displayBefore: string,
): Promise<void> {
  const input = root.querySelector<HTMLInputElement>(
    'input[role="combobox"], input[class*="selection-search-input"]',
  );
  const focusTarget = input ?? (root instanceof HTMLElement ? root : null);
  focusTarget?.focus();
  await delay('tick');

  // 当前是竖屏、要横屏：向下一次；反之向上一次；未知则多按几次
  const needDown = expected === '横屏' && displayBefore.includes('竖屏');
  const needUp = expected === '竖屏' && displayBefore.includes('横屏');
  const key = needUp ? 'ArrowUp' : 'ArrowDown';
  const times = needDown || needUp ? 1 : 2;

  for (let i = 0; i < times; i += 1) {
    dispatchKey(focusTarget ?? root, key);
    await delay('tick');
  }
  dispatchKey(focusTarget ?? root, 'Enter');
  await delay('tick');
}

/**
 * rc-select 选中逻辑挂在 option 的 onMouseDown（会 preventDefault）。
 * 直接对可见 `.tbd-select-item-option` 派发，避免 elementFromPoint 点到错误层。
 */
function fireRcSelectOptionMouseDown(element: Element): void {
  const option = element.closest(
    '.tbd-select-item-option, .ant-select-item-option, [class*="select-item-option"]',
  ) ?? element;
  const target = option instanceof HTMLElement ? option : option.parentElement;
  if (!target) return;

  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const rect = target.getBoundingClientRect();
  const clientX = rect.left + Math.max(rect.width / 2, 1);
  const clientY = rect.top + Math.max(rect.height / 2, 1);
  const down: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  };

  target.dispatchEvent(new MouseEvent('mousedown', down));
  target.dispatchEvent(new MouseEvent('mouseup', { ...down, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('click', { ...down, buttons: 0 }));
}

function clickAtElementCenter(element: Element): void {
  const target = element instanceof HTMLElement ? element : element.parentElement;
  if (!target) return;
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const rect = target.getBoundingClientRect();
  fireMouseOn(target, rect.left + Math.max(rect.width / 2, 1), rect.top + Math.max(rect.height / 2, 1));
}

function clickAtPoint(clientX: number, clientY: number, preferred?: Element): void {
  const hit = document.elementFromPoint(clientX, clientY) ?? preferred;
  if (!hit) return;
  const option = hit.closest?.(
    '.tbd-select-item-option, .ant-select-item-option, [class*="select-item-option"]',
  );
  if (option) {
    fireRcSelectOptionMouseDown(option);
    return;
  }
  const target = hit instanceof HTMLElement ? hit : hit.parentElement;
  if (!target) return;
  fireMouseOn(target, clientX, clientY);
}

function fireMouseOn(target: HTMLElement, clientX: number, clientY: number): void {
  const common: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  };
  target.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 1, pointerType: 'mouse' }));
  target.dispatchEvent(new MouseEvent('mousedown', common));
  target.dispatchEvent(new PointerEvent('pointerup', {
    ...common,
    buttons: 0,
    pointerId: 1,
    pointerType: 'mouse',
  }));
  target.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('click', { ...common, buttons: 0 }));
}

function dispatchKey(target: Element, key: string) {
  const init: KeyboardEventInit = {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

function closeDropdown(root: Element) {
  const input = root.querySelector<HTMLInputElement>('input[role="combobox"]');
  const target = input ?? root;
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  }));
}

function queryFirstVisible(root: ParentNode, selector: string): Element | undefined {
  if (!(root instanceof Element || root instanceof Document)) return undefined;
  for (const el of Array.from(root.querySelectorAll(selector))) {
    if (!isVisibleEnough(el)) continue;
    if (el instanceof HTMLInputElement) continue;
    return el;
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
