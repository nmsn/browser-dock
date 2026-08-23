import {
  getElementVisibleText,
  normalizeVisibleText,
} from '../../../../../../shared/automation/dom-actions';
import { waitUntil } from '../../../../../../shared/automation/wait';

/**
 * Fusion next-select 单选/多选共用 DOM 原语。
 */

export const NEXT_SELECT_ROOT_SELECTOR = [
  '.next-select.next-select-trigger',
  '.next-select-trigger',
  'span.next-select',
].join(',');

export const NEXT_SELECT_DROPDOWN_SELECTOR = [
  'ul.next-select-menu[role="listbox"]',
  'ul.next-menu.next-select-menu',
  'ul.next-select-multiple-menu',
  'ul.next-overlay-inner[role="listbox"]',
  '.next-select-menu[role="listbox"]',
].join(',');

export const NEXT_SELECT_OPTION_SELECTOR = [
  'li.next-menu-item',
  'li.next-select-menu-item',
  '[role="option"].next-menu-item',
  '[role="option"]',
].join(',');

export function isVisibleEnough(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function isNextMultiSelectRoot(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const cls = el.className?.toString?.() ?? '';
  return /\bnext-select-multiple\b/.test(cls)
    || /\bmultiple\b/.test(cls) && /\bnext-select\b/.test(cls)
    || Boolean(el.closest('.next-select-multiple'));
}

export function findNextSelectRoot(scope: ParentNode): HTMLElement | undefined {
  if (scope instanceof Element) {
    const self = scope.closest(NEXT_SELECT_ROOT_SELECTOR);
    if (self instanceof HTMLElement && isVisibleEnough(self)) return self;
    // CascaderSelect 等可能只有 .next-select，无 next-select-trigger
    if (scope instanceof HTMLElement && scope.matches('.next-select') && isVisibleEnough(scope)) {
      return scope;
    }
  }

  const nodes = scope.querySelectorAll<HTMLElement>(NEXT_SELECT_ROOT_SELECTOR);
  for (const el of nodes) {
    if (isVisibleEnough(el)) return el;
  }
  for (const el of scope.querySelectorAll<HTMLElement>('.next-select')) {
    if (isVisibleEnough(el)) return el;
  }
  return undefined;
}

/**
 * 从 label 向后扫兄弟，直到下一个字段 label；取第一个 next-select。
 * C48 优惠券：`.alp-dl-label` + 右侧 sibling `.next-select`（领取条件 / 投放渠道同卡）。
 */
export function findSelectAmongNextSiblings(
  labelEl: Element,
  accept: (el: HTMLElement) => boolean = () => true,
): HTMLElement | undefined {
  let sibling = labelEl.nextElementSibling;
  while (sibling) {
    if (sibling instanceof HTMLElement) {
      const sibLabel = normalizeVisibleText(
        sibling.matches('.alp-dl-label, label') ? (sibling.textContent ?? '') : '',
      );
      if (
        sibling.matches('.alp-dl-label')
        || (sibling.matches('label') && sibLabel.length > 0 && sibLabel.length <= 16
          && !sibling.querySelector('.next-select'))
      ) {
        break;
      }
      if (sibling.matches('.next-select, .next-select-trigger') && accept(sibling)) {
        return sibling;
      }
      const nested =
        sibling.querySelector<HTMLElement>(NEXT_SELECT_ROOT_SELECTOR)
        ?? sibling.querySelector<HTMLElement>('.next-select');
      if (nested && isVisibleEnough(nested) && accept(nested)) return nested;
    }
    sibling = sibling.nextElementSibling;
  }
  return undefined;
}

/** 在 scope 内按标签文案找 next-select（内嵌 label 或左侧表单 label） */
export function findNextSelectByLabel(
  labels: string[],
  root?: ParentNode,
  options?: { multiple?: boolean },
): HTMLElement | undefined {
  const scope = root ?? document;
  const wantMultiple = options?.multiple;
  const nodes = scope.querySelectorAll<HTMLElement>(NEXT_SELECT_ROOT_SELECTOR);

  const accept = (el: HTMLElement) => {
    if (!isVisibleEnough(el)) return false;
    if (wantMultiple === true) return isNextMultiSelectRoot(el);
    if (wantMultiple === false) return !isNextMultiSelectRoot(el);
    return true;
  };

  // 1) 标签写在 select 内部（持续时间：）
  for (const el of nodes) {
    if (!accept(el)) continue;
    const text = normalizeVisibleText(el.textContent ?? '');
    const labelEl = el.querySelector('.next-input-label, label');
    const labelText = normalizeVisibleText(labelEl?.textContent ?? '');
    for (const label of labels) {
      const want = normalizeVisibleText(label);
      if (!want) continue;
      if (labelText.includes(want) || text.includes(want)) return el;
    }
    const input = el.querySelector('input');
    const id = input?.id ?? '';
    if (labels.some((l) => l.includes('持续') || l.includes('结束')) && id === 'endTime') {
      return el;
    }
  }

  // 2) 标签在表单项左侧，select 在同行/同容器（活动人群 / C48 alp-dl-label）
  for (const label of labels) {
    const want = normalizeVisibleText(label);
    if (!want) continue;
    const labelNodes = scope.querySelectorAll<HTMLElement>(
      '.alp-dl-label, label, span, div, p, th, td',
    );
    for (const node of labelNodes) {
      const raw = normalizeVisibleText(node.textContent ?? '');
      if (raw !== want && raw !== `${want}：` && raw !== `${want}:`) continue;
      if (!isVisibleEnough(node)) continue;

      // C48：label 后紧邻兄弟即对应 select；勿用整卡 query 命中「领取条件」
      const afterLabel = findSelectAmongNextSiblings(node, accept);
      if (afterLabel) return afterLabel;

      let parent: HTMLElement | null = node.parentElement;
      for (let depth = 0; depth < 8 && parent; depth += 1) {
        // 仅当父级内只有一个 select 时才采用，避免同卡多字段串台
        const selectsInParent = Array.from(
          parent.querySelectorAll<HTMLElement>(NEXT_SELECT_ROOT_SELECTOR),
        ).filter((el) => accept(el) && !el.contains(node));
        if (selectsInParent.length === 1) {
          return selectsInParent[0];
        }
        let sibling: Element | null = parent.nextElementSibling;
        while (sibling) {
          if (sibling instanceof HTMLElement) {
            const inSibling = findNextSelectRoot(sibling);
            if (inSibling && accept(inSibling)) return inSibling;
          }
          sibling = sibling.nextElementSibling;
        }
        parent = parent.parentElement;
      }
    }
  }

  return undefined;
}

export function findNextSelectTrigger(scope: ParentNode): HTMLElement | undefined {
  const root = findNextSelectRoot(scope);
  if (!root) return undefined;
  const inner = root.querySelector<HTMLElement>('.next-select-inner, .next-input');
  if (inner && isVisibleEnough(inner)) return inner;
  return root;
}

export function readNextSelectDisplay(scope: ParentNode): string {
  const root = findNextSelectRoot(scope) ?? (scope instanceof HTMLElement ? scope : undefined);
  if (!root) return '';

  const emOnly = root.querySelector('.next-select-values em');
  if (emOnly) {
    const text = normalizeVisibleText(emOnly.textContent ?? '');
    if (text) return text;
  }

  // 多选常有多个 tag
  const tags = root.querySelectorAll('.next-tag-body, .next-select-tag, .next-tag');
  if (tags.length > 0) {
    return Array.from(tags)
      .map((el) => normalizeVisibleText(el.textContent ?? ''))
      .filter(Boolean)
      .join(' ');
  }

  const input = root.querySelector<HTMLInputElement>('input[role="combobox"], input');
  const aria = input?.getAttribute('aria-valuetext')?.trim();
  if (aria) return normalizeVisibleText(aria);

  const value = input?.value?.trim();
  if (value) return normalizeVisibleText(value);

  return normalizeVisibleText(getElementVisibleText(root))
    .replace(/^持续时间：?/, '')
    .replace(/^活动人群：?/, '')
    .trim();
}

export function nextSelectDisplayMatches(scope: ParentNode, expected: string): boolean {
  const actual = readNextSelectDisplay(scope);
  const want = normalizeVisibleText(expected);
  if (!actual || !want) return false;
  return actual === want || actual.includes(want);
}

export function isNextSelectInError(scope: ParentNode): boolean {
  const root = findNextSelectRoot(scope);
  if (!root) return false;
  return /\bnext-error\b/.test(root.className)
    || Boolean(root.querySelector('.next-error, .next-input.next-error'));
}

export function resolveNextSelectOpenTarget(
  root: HTMLElement,
  options?: { preferValues?: boolean },
): HTMLElement {
  if (options?.preferValues) {
    const values = root.querySelector<HTMLElement>('.next-select-values, em, input[role="combobox"]');
    if (values && isVisibleEnough(values)) return values;
  }
  const arrow = root.querySelector<HTMLElement>('.next-select-arrow');
  if (arrow && isVisibleEnough(arrow)) return arrow;
  const values = root.querySelector<HTMLElement>('.next-select-values, input[role="combobox"]');
  if (values && isVisibleEnough(values)) return values;
  const inner = root.querySelector<HTMLElement>('.next-select-inner');
  if (inner && isVisibleEnough(inner)) return inner;
  return root;
}

/** Fusion 常用 mousedown 打开；不要 scrollIntoView（会抖导致浮层收起） */
export function fireSelectOpen(target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  const clientX = rect.left + Math.max(rect.width / 2, 1);
  const clientY = rect.top + Math.max(rect.height / 2, 1);
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

export function fireMenuItemClick(element: HTMLElement): void {
  const target = element.querySelector<HTMLElement>(
    '.next-select-all-inner, .next-menu-item-text, .next-menu-item-inner',
  ) ?? element;
  const rect = target.getBoundingClientRect();
  const clientX = rect.left + Math.max(rect.width / 2, 1);
  const clientY = rect.top + Math.max(rect.height / 2, 1);
  const common: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  };
  target.dispatchEvent(new MouseEvent('mousedown', common));
  target.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('click', { ...common, buttons: 0 }));
}

export async function waitForNextSelectDropdown(
  timeoutMs: number,
  options?: { multiple?: boolean },
): Promise<HTMLElement | undefined> {
  const found = await waitUntil(
    () => findVisibleNextSelectDropdown(options),
    { timeoutMs, intervalMs: 40 },
  );
  return found ?? findVisibleNextSelectDropdown(options);
}

export function findVisibleNextSelectDropdown(
  options?: { multiple?: boolean },
): HTMLElement | undefined {
  const preferMultiple = options?.multiple;
  const nodes = document.querySelectorAll<HTMLElement>(NEXT_SELECT_DROPDOWN_SELECTOR);
  for (const el of nodes) {
    if (!isVisibleEnough(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const isMulti = el.className.includes('multiple')
      || el.getAttribute('aria-multiselectable') === 'true'
      || Boolean(el.querySelector('.next-select-all'));
    if (preferMultiple === true && !isMulti) continue;
    if (preferMultiple === false && isMulti) continue;
    return el;
  }

  for (const el of document.querySelectorAll<HTMLElement>('ul[role="listbox"], div[role="listbox"]')) {
    if (!isVisibleEnough(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const isMulti = el.className.includes('multiple')
      || el.getAttribute('aria-multiselectable') === 'true'
      || Boolean(el.querySelector('.next-select-all'));
    if (preferMultiple === true && !isMulti) continue;
    if (preferMultiple === false && isMulti) continue;
    if (el.querySelector(NEXT_SELECT_OPTION_SELECTOR) || el.querySelector('[role="option"]') || el.querySelector('.next-select-all')) {
      return el;
    }
  }
  return undefined;
}

export function listMenuOptionLabels(dropdown: ParentNode): string[] {
  const labels: string[] = [];
  const selectAll = dropdown.querySelector('.next-select-all, .next-select-all-inner, .next-menu-header');
  if (selectAll) {
    const text = normalizeVisibleText(selectAll.textContent ?? '');
    if (text) labels.push(text);
  }
  for (const el of dropdown.querySelectorAll<HTMLElement>(NEXT_SELECT_OPTION_SELECTOR)) {
    const text = normalizeVisibleText(
      el.querySelector('.next-menu-item-text')?.textContent ?? el.textContent ?? '',
    );
    if (text) labels.push(text);
  }
  return labels.slice(0, 10);
}

export function findMenuOptionByText(
  dropdown: ParentNode,
  expected: string,
): HTMLElement | undefined {
  const want = normalizeVisibleText(expected);
  const options = Array.from(dropdown.querySelectorAll<HTMLElement>(NEXT_SELECT_OPTION_SELECTOR));
  const readText = (el: HTMLElement) => normalizeVisibleText(
    el.querySelector('.next-menu-item-text')?.textContent
    ?? el.textContent
    ?? '',
  );

  for (const el of options) {
    if (readText(el) === want) return el;
  }
  for (const el of options) {
    const text = readText(el);
    if (text.includes(want) || want.includes(text)) return el;
  }
  return undefined;
}
