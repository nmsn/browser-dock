/**
 * Fusion CascaderSelect / Ant Cascader：按路径逐级点全局浮层。
 * 实页（C48）：trigger 为 `.next-select`，浮层 `.next-cascader-select-dropdown` + `.next-cascader-menu-item`。
 * 打开勿用 scrollIntoView（会抖掉 overlay）；父级先 hover 再点以兼容展开。
 */

import { findElementByText, normalizeVisibleText } from '../../../../../../shared/automation/dom-actions';
import { delay } from '../../../../../../shared/automation/delay';
import { waitUntil } from '../../../../../../shared/automation/wait';
import { queryAllDeep } from '../../deep-dom';
import { selectOptionNearLabel } from '../../form-options';
import {
  findNextSelectRoot,
  fireMenuItemClick,
  fireSelectOpen,
  nextSelectDisplayMatches,
  resolveNextSelectOpenTarget,
} from '../select/next-fusion-shared';

export type SelectCascaderPathResult = {
  ok: boolean;
  detail: string;
};

const CASCADER_TRIGGER_SELECTOR = [
  '.next-cascader',
  '.ant-cascader',
  '.ant-cascader-picker',
  '[class*="cascader"]',
  '.next-select',
  '.ant-select',
  '[role="combobox"]',
  '.next-input',
].join(', ');

const CASCADER_MENU_SELECTOR = [
  '.next-cascader-menu',
  '.ant-cascader-menu',
  '.ant-cascader-menus',
  '.next-cascader-menu-wrapper',
  '.next-cascader-select-dropdown',
  '.ant-cascader-dropdown',
  '.next-overlay-inner',
  'ul[role="listbox"]',
].join(', ');

const CASCADER_MENU_ITEM_SELECTOR = [
  '.next-cascader-menu-item',
  '.ant-cascader-menu-item',
  '.next-menu-item',
  '.ant-select-item',
  '.ant-select-item-option',
  '[role="option"]',
  '[role="menuitem"]',
  '.next-menu-item-text',
].join(', ');

function compactVisibleText(value: string): string {
  return normalizeVisibleText(value).replace(/\s+/g, '');
}

function isVisibleEl(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * 按标签定位字段容器，并按 path 选择级联项。
 * @param fieldLabels 如 ['领取条件']
 *
 * 策略（避免浮层反复开关）：
 * - 最多 2 次尝试（首次 + 1 次重试）
 * - 打开一次后优先直接点叶子；回读只认叶子文案
 * - 已打开时不再点触发器（Fusion 会 toggle 收起）
 */
export async function selectCascaderPathNearLabel(
  fieldLabels: string[],
  path: string[],
): Promise<SelectCascaderPathResult> {
  const normalized = path.map((part) => normalizeVisibleText(part)).filter(Boolean);
  if (normalized.length === 0) {
    return { ok: false, detail: '级联路径为空。' };
  }

  if (normalized.length === 1) {
    const leaf = normalized[0]!;
    if (await selectOptionNearLabel(fieldLabels, leaf)) {
      return { ok: true, detail: '' };
    }
  }

  let lastDetail = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await trySelectCascaderPath(fieldLabels, normalized);
    if (result.ok) return { ok: true, detail: '' };
    lastDetail = result.detail;
    if (attempt === 0) await delay('short');
  }
  return { ok: false, detail: lastDetail || '级联选择失败。' };
}

async function trySelectCascaderPath(
  fieldLabels: string[],
  path: string[],
): Promise<SelectCascaderPathResult> {
  const field = findCascaderField(fieldLabels);
  if (!field) {
    return {
      ok: false,
      detail: `未找到「${fieldLabels[0] ?? '字段'}」表单项。${probeCascaderMenus()}`,
    };
  }
  if (isCascaderPathSelected(path, field)) {
    return { ok: true, detail: '' };
  }

  const opened = await openCascaderTrigger(field, fieldLabels);
  if (!opened) {
    return {
      ok: false,
      detail: `未能打开「${fieldLabels[0] ?? '字段'}」级联浮层。${probeCascaderMenus()}`,
    };
  }

  const leaf = path[path.length - 1]!;
  const displayBefore = readCascaderDisplay(field);

  // 优先：叶子已在浮层中（C48 常已展开次列）→ 直接点叶子，成功即返回，不再走父级
  if (path.length >= 2) {
    const leafReady = await waitUntil(
      () => findCascaderMenuOption(leaf),
      { timeoutMs: 800, intervalMs: 80 },
    );
    if (leafReady) {
      const leafItem = resolveCascaderMenuItem(leafReady);
      if (leafItem) {
        fireMenuItemClick(leafItem);
        if (await waitCascaderApplied(path, field, displayBefore)) {
          return { ok: true, detail: '' };
        }
        // 已点叶子但回读未变：本轮结束，交给外层最多再试 1 次（避免同轮反复开浮层）
        return {
          ok: false,
          detail: `已点「${leaf}」，但回读未匹配。展示=${readCascaderDisplay(field) || '(空)'}。`,
        };
      }
    }
  }

  // 叶子不可见：hover 展开父级后点叶子（全程不对菜单项/已开触发器 fireSelectOpen）
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i]!;
    const isLast = i === path.length - 1;

    if (!cascaderMenuLooksOpen()) {
      const reopened = await openCascaderTrigger(field, fieldLabels);
      if (!reopened) {
        return {
          ok: false,
          detail: `级联浮层已关闭，无法继续选「${segment}」。${probeCascaderMenus()}`,
        };
      }
    }

    const option = await waitUntil(
      () => findCascaderMenuOption(segment),
      { timeoutMs: 2500, intervalMs: 100 },
    );
    if (!option) {
      return {
        ok: false,
        detail: `浮层中未找到「${segment}」（路径第 ${i + 1}/${path.length} 级）。${probeCascaderMenus()}`,
      };
    }

    const menuItem = resolveCascaderMenuItem(option);
    if (!menuItem) {
      return {
        ok: false,
        detail: `找到「${segment}」文案但无法定位可点菜单项。${probeCascaderMenus()}`,
      };
    }

    if (isLast) {
      fireMenuItemClick(menuItem);
      break;
    }

    const nextSeg = path[i + 1]!;
    if (findCascaderMenuOption(nextSeg)) continue;

    firePointerEnter(menuItem);
    await delay('tick');
    const nextReady = await waitUntil(
      () => findCascaderMenuOption(nextSeg),
      { timeoutMs: 1200, intervalMs: 80 },
    );
    if (!nextReady) {
      // 轻点父级展开（不 fireSelectOpen）
      fireMenuItemClick(menuItem);
      const afterClick = await waitUntil(
        () => findCascaderMenuOption(nextSeg),
        { timeoutMs: 1200, intervalMs: 80 },
      );
      if (!afterClick) {
        return {
          ok: false,
          detail: `已展开「${segment}」，但未出现下级「${nextSeg}」。${probeCascaderMenus()}`,
        };
      }
    }
  }

  if (await waitCascaderApplied(path, field, displayBefore)) {
    return { ok: true, detail: '' };
  }
  return {
    ok: false,
    detail: `已点完路径，但回读未匹配「${path.join(' / ')}」。展示=${readCascaderDisplay(field) || '(空)'}。${probeCascaderMenus()}`,
  };
}

function cascaderMenuLooksOpen(): boolean {
  return hasVisibleCascaderMenu()
    || Boolean(findCascaderMenuOption('不限'))
    || Boolean(findCascaderMenuOption('限粉丝身份'))
    || Boolean(findCascaderMenuOption('限观众行为'));
}

/** 回读以叶子为准；展示更新有短暂延迟 */
async function waitCascaderApplied(
  path: string[],
  field: Element,
  displayBefore: string,
): Promise<boolean> {
  const leaf = path[path.length - 1]!;
  const applied = await waitUntil(
    () => {
      if (isCascaderPathSelected(path, field)) return true;
      const display = readCascaderDisplay(field);
      // 选中后浮层收起，且展示相对打开前有变化且含叶子
      if (
        display
        && display.includes(leaf)
        && display !== displayBefore
      ) {
        return true;
      }
      return undefined;
    },
    { timeoutMs: 1200, intervalMs: 80 },
  );
  return Boolean(applied) || isCascaderPathSelected(path, field);
}

/** 含 C48 `.alp-dl-label` + 右侧 sibling `.next-select`（CascaderSelect） */
export function findCascaderField(fieldLabels: string[]): Element | undefined {
  for (const label of fieldLabels) {
    const want = normalizeVisibleText(label);
    if (!want) continue;

    // C48：alp-dl-label 的下一个兄弟即 CascaderSelect 触发器（勿回退到整张卡片）
    for (const labelEl of queryAllDeep<HTMLElement>('.alp-dl-label, label')) {
      if (!isVisibleEl(labelEl)) continue;
      if (normalizeVisibleText(labelEl.textContent ?? '') !== want) continue;
      let sibling = labelEl.nextElementSibling;
      while (sibling) {
        if (sibling instanceof HTMLElement) {
          if (sibling.matches('.next-select, .next-cascader, .ant-cascader, .ant-cascader-picker')) {
            return sibling;
          }
          const nested = sibling.querySelector<HTMLElement>(
            '.next-select, .next-cascader, .ant-cascader, .ant-cascader-picker',
          );
          if (nested && isVisibleEl(nested)) return nested;
        }
        sibling = sibling.nextElementSibling;
      }
    }

    const formItems = queryAllDeep<HTMLElement>(
      '.next-form-item, .ant-form-item, .form-item, [class*="form-item"], [class*="FormItem"]',
    );
    for (const item of formItems) {
      if (!isVisibleEl(item)) continue;
      const text = normalizeVisibleText(item.textContent ?? '');
      if (!text.includes(want)) continue;
      // 优先返回本表单项内的 cascader/select，避免整卡多控件串台
      const trigger = item.querySelector<HTMLElement>(
        '.next-cascader, .ant-cascader, .ant-cascader-picker, .next-select, .ant-select',
      );
      if (trigger && isVisibleEl(trigger)) return trigger;
      if (item.querySelector('input')) return item;
    }

    const labelEl =
      findElementByText(want, {
        selector: 'label, span, div, p',
        exact: true,
      })
      ?? findElementByText(want, {
        selector: 'label, span, div, p',
        exact: false,
      });
    if (labelEl) {
      const item =
        labelEl.closest('.next-form-item, .ant-form-item, .form-item, [class*="form-item"], [class*="FormItem"]')
        ?? labelEl.parentElement;
      if (item) {
        const trigger = item.querySelector<HTMLElement>(
          '.next-cascader, .ant-cascader, .ant-cascader-picker, .next-select, .ant-select',
        );
        if (trigger && isVisibleEl(trigger)) return trigger;
        return item;
      }
    }
  }
  return undefined;
}

async function openCascaderTrigger(field: Element, fieldLabels: string[]): Promise<boolean> {
  if (cascaderMenuLooksOpen()) return true;

  const tryOpen = async (trigger: HTMLElement): Promise<boolean> => {
    // 已打开时再 mousedown 会 toggle 收起
    if (cascaderMenuLooksOpen()) return true;
    fireSelectOpen(trigger);
    const input = trigger.querySelector<HTMLElement>('input, .next-input, [role="combobox"]');
    if (input && input !== trigger) fireSelectOpen(input);
    await delay('short');
    const menu = await waitUntil(
      () => (cascaderMenuLooksOpen() ? true : undefined),
      { timeoutMs: 1500, intervalMs: 80 },
    );
    return Boolean(menu);
  };

  // field 本身已是触发器（findCascaderField 返回 sibling .next-select）
  if (
    field instanceof HTMLElement
    && field.matches('.next-select, .next-cascader, .ant-cascader, .ant-cascader-picker')
  ) {
    if (await tryOpen(field)) return true;
  }

  // C48：label 旁 sibling next-select
  for (const label of fieldLabels) {
    const want = normalizeVisibleText(label);
    for (const labelEl of queryAllDeep<HTMLElement>('.alp-dl-label, label')) {
      if (normalizeVisibleText(labelEl.textContent ?? '') !== want) continue;
      let sibling = labelEl.nextElementSibling;
      while (sibling) {
        if (sibling instanceof HTMLElement && sibling.matches('.alp-dl-label')) break;
        const trigger =
          sibling instanceof HTMLElement && sibling.matches('.next-select, .next-cascader, .ant-cascader')
            ? sibling
            : sibling.querySelector<HTMLElement>('.next-select, .next-cascader, .ant-cascader');
        if (trigger && await tryOpen(trigger)) return true;
        sibling = sibling.nextElementSibling;
      }
    }
  }

  const cascader =
    (field instanceof HTMLElement
      ? field.querySelector<HTMLElement>('.next-cascader, .ant-cascader, .ant-cascader-picker, [class*="cascader"], .next-select')
      : null);

  if (cascader) {
    if (await tryOpen(cascader)) return true;
  } else {
    const nextRoot = findNextSelectRoot(field);
    if (nextRoot) {
      if (await tryOpen(resolveNextSelectOpenTarget(nextRoot))) return true;
    } else {
      const trigger =
        field.querySelector<HTMLElement>(CASCADER_TRIGGER_SELECTOR)
        ?? field.querySelector<HTMLElement>('input');
      if (!trigger) return false;
      if (await tryOpen(trigger)) return true;
    }
  }

  await delay('short');
  const menu = await waitUntil(
    () => (cascaderMenuLooksOpen() ? true : undefined),
    { timeoutMs: 1500, intervalMs: 80 },
  );
  return Boolean(menu);
}

function hasVisibleCascaderMenu(): boolean {
  return queryAllDeep<HTMLElement>(CASCADER_MENU_SELECTOR).some((el) => isVisibleEl(el));
}

function resolveCascaderMenuItem(option: Element): HTMLElement | undefined {
  return (
    option.closest<HTMLElement>(
      'li.next-cascader-menu-item, .ant-cascader-menu-item, li.next-menu-item, .ant-select-item, [role="option"], [role="menuitem"], li',
    )
    ?? (option instanceof HTMLElement ? option : null)
    ?? undefined
  );
}

function firePointerEnter(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + Math.max(rect.width / 2, 1);
  const clientY = rect.top + Math.max(rect.height / 2, 1);
  const common: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
  };
  element.dispatchEvent(new MouseEvent('mouseover', common));
  element.dispatchEvent(new MouseEvent('mouseenter', { ...common, bubbles: false }));
  element.dispatchEvent(new PointerEvent('pointermove', {
    ...common,
    pointerId: 1,
    pointerType: 'mouse',
  }));
}

export function readCascaderDisplay(field: Element): string {
  // 字段本身就是 next-select / cascader 触发器
  if (field instanceof HTMLElement) {
    const selfCls = field.className?.toString?.() ?? '';
    if (/\bnext-select\b|\bcascader\b/i.test(selfCls)) {
      const bits = field.querySelectorAll<HTMLElement>('.next-select-values em, em, .next-input-text-field');
      if (bits.length) {
        const joined = Array.from(bits)
          .map((el) => normalizeVisibleText(el.textContent ?? ''))
          .filter(Boolean)
          .join(' / ');
        if (joined) return joined;
      }
      const selfText = normalizeVisibleText(field.textContent ?? '');
      if (selfText) return selfText;
    }
  }

  const nextRoot = findNextSelectRoot(field);
  if (nextRoot) {
    const bits = nextRoot.querySelectorAll<HTMLElement>('.next-select-values em, em');
    if (bits.length) {
      return Array.from(bits)
        .map((el) => normalizeVisibleText(el.textContent ?? ''))
        .filter(Boolean)
        .join(' / ');
    }
    const rootText = normalizeVisibleText(nextRoot.textContent ?? '');
    if (rootText) return rootText;
  }
  const selectedBits = field.querySelectorAll<HTMLElement>(
    '.next-select-values em, .ant-select-selection-item, .ant-cascader-picker-label, .ant-select-selection-selected-value, [class*="selection-item"], .next-input-text-field',
  );
  for (const bit of selectedBits) {
    const text = normalizeVisibleText(bit.textContent ?? '');
    if (text) return text;
  }
  const input = field.querySelector<HTMLInputElement>('input[role="combobox"], input');
  if (input) {
    const aria = normalizeVisibleText(input.getAttribute('aria-valuetext') ?? '');
    if (aria) return aria;
    const value = normalizeVisibleText(input.value ?? '');
    if (value) return value;
  }
  return normalizeVisibleText(field.textContent ?? '')
    .replace(/领取条件/g, '')
    .replace(/请选择领取条件/g, '')
    .replace(/请选择/g, '')
    .trim();
}

export function isCascaderPathSelected(path: string[], field: Element): boolean {
  if (path.length === 0) return false;
  const leaf = path[path.length - 1]!;
  const joined = path.join(' / ');
  const joinedCompact = path.join('/');
  const joinedArrow = path.join(' > ');
  const display = readCascaderDisplay(field);
  const displayCompact = compactVisibleText(display);

  // Fusion 常只回显叶子（如「挚爱及以上」），以叶子匹配为准
  if (display) {
    if (
      display === leaf
      || displayCompact === compactVisibleText(leaf)
      || display.includes(leaf)
      || displayCompact.includes(compactVisibleText(leaf))
      || display === joined
      || display === joinedCompact
      || display === joinedArrow
      || display.includes(joined)
      || display.includes(joinedCompact)
    ) {
      return true;
    }
  }

  const nextRoot = findNextSelectRoot(field);
  if (
    nextRoot
    && (nextSelectDisplayMatches(nextRoot, leaf)
      || nextSelectDisplayMatches(nextRoot, joined)
      || nextSelectDisplayMatches(nextRoot, joinedCompact))
  ) {
    return true;
  }

  return false;
}

function cascaderItemLabel(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement;
  for (const arrow of clone.querySelectorAll(
    '.next-cascader-menu-icon, .next-cascader-icon-right, .ant-cascader-menu-item-expand-icon, [class*="expand-icon"], [class*="arrow"], i.next-icon',
  )) {
    arrow.remove();
  }
  return normalizeVisibleText(clone.textContent ?? '')
    .replace(/>+$/g, '')
    .replace(/›+$/g, '')
    .trim();
}

function findCascaderMenuOption(want: string): Element | undefined {
  const wantNorm = normalizeVisibleText(want);
  const wantCompact = compactVisibleText(want);

  const score = (node: HTMLElement): number | undefined => {
    if (!isVisibleEl(node)) return undefined;
    const text = cascaderItemLabel(node);
    const compact = compactVisibleText(text);
    if (!text) return undefined;
    if (text === wantNorm || compact === wantCompact) return 0;
    if (text.startsWith(wantNorm) && compact.length <= wantCompact.length + 4) return 1;
    if (text.includes(wantNorm) || compact.includes(wantCompact)) {
      if (compact.length <= wantCompact.length + 6) return 2;
    }
    return undefined;
  };

  let best: { el: Element; score: number } | undefined;
  const consider = (node: HTMLElement) => {
    const s = score(node);
    if (s === undefined) return;
    if (!best || s < best.score) best = { el: node, score: s };
  };

  for (const node of queryAllDeep<HTMLElement>(CASCADER_MENU_ITEM_SELECTOR)) {
    consider(node);
    if (best?.score === 0) return best.el;
  }

  for (const menu of queryAllDeep<HTMLElement>(CASCADER_MENU_SELECTOR)) {
    if (!isVisibleEl(menu)) continue;
    for (const child of Array.from(
      menu.querySelectorAll<HTMLElement>('li, [role="option"], [role="menuitem"], div, span'),
    )) {
      consider(child);
      if (best?.score === 0) return best.el;
    }
  }

  return best?.el;
}

function probeCascaderMenus(): string {
  const labels: string[] = [];
  for (const node of queryAllDeep<HTMLElement>(CASCADER_MENU_ITEM_SELECTOR)) {
    if (!isVisibleEl(node)) continue;
    const text = cascaderItemLabel(node);
    if (text && !labels.includes(text)) labels.push(text);
    if (labels.length >= 12) break;
  }
  if (labels.length === 0) {
    for (const menu of queryAllDeep<HTMLElement>(CASCADER_MENU_SELECTOR)) {
      if (!isVisibleEl(menu)) continue;
      for (const child of Array.from(menu.querySelectorAll<HTMLElement>('li, [role="option"], [role="menuitem"]'))) {
        if (!isVisibleEl(child)) continue;
        const text = cascaderItemLabel(child);
        if (text && !labels.includes(text)) labels.push(text);
        if (labels.length >= 12) break;
      }
    }
  }
  return labels.length
    ? `可见浮层项=[${labels.join(' | ')}]。`
    : '可见浮层项=[]。';
}
