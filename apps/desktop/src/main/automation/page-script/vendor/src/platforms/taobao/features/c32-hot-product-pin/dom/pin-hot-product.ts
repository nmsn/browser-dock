import {
  clickElement,
  fillTextInput,
  findElementByText,
  normalizeVisibleText,
} from '../../../../../shared/automation/dom-actions';
import { delay } from '../../../../../shared/automation/delay';
import { formatDuration } from '../../../../../shared/automation/format-duration';
import { sleepMs } from '../../../../../shared/automation/sleep';
import {
  waitRequiredValue,
  waitUntilLive,
  WaitTimeout,
  type AutomationDomContext,
  type AutomationLogSink,
} from '../../../../../shared/automation/wait';
import {
  findNextSelectRoot,
  findTbdSelectRoot,
  findTbdSelectTrigger,
  nextSelectDisplayMatches,
  readNextSelectDisplay,
  readTbdSelectDisplay,
  selectNextSelectOptionDetailed,
  selectTbdSelectOptionDetailed,
  tbdSelectDisplayMatches,
} from '../../../shared/dom/adapters';
import { queryAllDeep } from '../../../shared/dom/deep-dom';
import { findClickableByText } from '../../../shared/dom/finders';
import { fillAndVerifyTextResilient } from '../../../shared/dom/verified-inputs';

const PIN_ACTION_LOG_ID = 'ItemTopAction__baopinzhiding';
/** 已置顶商品的「取消置顶」图标：data-tblalog-id 与 baopinzhiding 不同，class 相同。 */
const PIN_CANCEL_ACTION_LOG_ID = 'ItemTopAction__quXiaoZhiDing';
/** 实页常见「口袋商品」；需求原文为「全部商品」。两者都认。 */
const POCKET_TAB_LABELS = ['口袋商品', '全部商品'] as const;
/**
 * 实页口袋 Tab：自定义 div.tabs-header-item--*，无 role="tab"。
 * CDP（2026-09-02）确认优先用此选择器，勿依赖 [role="tab"]。
 */
const POCKET_TAB_ITEM_SELECTOR = '[class*="tabs-header-item"]';
/** 点击 / closest 时认作 Tab 可点根节点 */
const POCKET_TAB_CLICKABLE_CLOSEST =
  '[class*="tabs-header-item"], [role="tab"], button, [role="button"], a';
/** 口袋商品搜索维度：必须先切到「商品ID」，否则停在「商品标题」等时按 ID 搜不到 */
const PRODUCT_ID_SEARCH_MODE = '商品ID';
const PRODUCT_SEARCH_MODE_HINTS = [
  '商品ID',
  '商品id',
  '商品标题',
  '全部',
  '商品名称',
  '商品链接',
] as const;

export type PinHotProductDomResult = {
  ok: boolean;
  detail: string;
  pocketTabReady: boolean;
  productSearchModeSet: boolean;
  productSearchFilled: boolean;
  productFound: boolean;
  pinClicked: boolean;
  pinConfirmed: boolean;
};

export type PinHotProductOptions = AutomationDomContext;

export async function pinHotProductById(
  productId: string,
  ctx: PinHotProductOptions,
): Promise<PinHotProductDomResult> {
  const { log } = ctx;
  const wantId = normalizeVisibleText(productId);
  const base: PinHotProductDomResult = {
    ok: false,
    detail: '',
    pocketTabReady: false,
    productSearchModeSet: false,
    productSearchFilled: false,
    productFound: false,
    pinClicked: false,
    pinConfirmed: false,
  };

  if (!wantId) {
    return { ...base, detail: '商品 ID 为空' };
  }

  // 上个失败会话可能遗留「爆品/宝贝」确认弹窗（遮挡口袋商品 Tab / 搜索），先清理
  await dismissLeftoverHotProductDialogs();

  const tabOk = await ensurePocketProductsTab(log);
  base.pocketTabReady = tabOk;
  if (!tabOk) {
    return {
      ...base,
      // 记录 413：不要写「详情页可能未加载完」——本消息只投顶层 frame，
      // 真出问题也是顶层文档本身（Tab 文案变更 / 弹窗遮挡），不是「页面没加载完」。
      detail:
        '未能激活「口袋商品/全部商品」Tab（Tab 可能被弹窗遮挡或页面样式已更新，详见执行日志）',
    };
  }

  const mode = await ensureProductIdSearchMode(log);
  base.productSearchModeSet = mode.ok;
  if (!mode.ok) {
    return {
      ...base,
      detail: `未能将口袋商品搜索维度设为「${PRODUCT_ID_SEARCH_MODE}」：${mode.detail}`,
    };
  }

  const filled = await fillProductIdSearch(wantId, log);
  base.productSearchFilled = filled;
  if (!filled) {
    return { ...base, detail: '未能填写商品 ID 搜索框' };
  }

  const item = await waitForProductItem(wantId, WaitTimeout.default, log);
  base.productFound = Boolean(item);
  if (!item) {
    return { ...base, detail: `口袋商品中未找到商品 ID ${wantId}，请确认该商品已在口袋商品列表中` };
  }

  // 偶发竞态：搜索后行条目已入 DOM（data-item-id 命中），但行内图标尚未完成布局
  // （getBoundingClientRect 尺寸为 0 / 行仍在重排）。item 命中 ≠ 图标立即可见。
  // 「可置顶」与「已置顶」是同一次等待的互斥结局（见 waitForPinRowState）：先出现可见
  // 置顶图标即走置顶；先出现可见「取消置顶」即判为已置顶直接跳过，不必等满超时再兜底。
  // 等待每次按 ID 重新定位条目，规避搜索重渲染时旧条目节点被替换的竞态。
  const rowWaitStart = Date.now();
  const rowState = await waitForPinRowState(wantId, WaitTimeout.medium, log);
  const rowWaitMs = Date.now() - rowWaitStart;
  if (!rowState) {
    return {
      ...base,
      detail:
        '已找到商品，但未找到可点击的「设置爆品」按钮，也未识别到已置顶状态（页面样式可能已更新，详见执行日志）',
    };
  }
  if (rowState.state === 'already-pinned') {
    log(
      'info',
      `商品 ${wantId} 已是爆品（识别到「${PIN_CANCEL_ACTION_LOG_ID}」），跳过置顶（行状态等待 ${formatDuration(rowWaitMs)}）`,
    );
    base.pinConfirmed = true;
    return {
      ...base,
      ok: true,
      detail: `商品 ${wantId} 已是爆品，无需再次置顶`,
    };
  }
  const pin = rowState.element;

  // 置顶是开关：只点一次。点两次会先「设置爆品」再弹出「取消爆品设置」
  clickElement(pin);
  base.pinClicked = true;
  await delay('mid');

  const confirmResult = await confirmSetHotProductModal();
  base.pinConfirmed = confirmResult.ok;
  if (!confirmResult.ok) {
    return {
      ...base,
      detail: confirmResult.detail,
    };
  }

  return {
    ...base,
    ok: true,
    detail: confirmResult.detail || `已将商品 ${wantId} 置为爆品（已确认）`,
  };
}

/**
 * 业务就绪门禁：口袋 Tab 或搜索框任一出现即视为详情口袋区已挂载。
 * 不做 Tab 点击/激活（留给 ensurePocketProductsTab）。
 * 保守超时 25s：详情 SPA 冷开 + 最小化节流下口袋区挂载偏慢。
 */
export async function waitPocketProductsUiReady(
  log: AutomationLogSink,
  timeoutMs: number = WaitTimeout.xlong,
): Promise<boolean> {
  const ready = await waitRequiredValue(
    () => findPocketProductsTab() ?? findProductSearchInput() ?? undefined,
    {
      label: '口袋商品区就绪',
      failureReason: '未出现「口袋商品/全部商品」Tab 或商品搜索框',
      timeoutMs,
      intervalMs: 250,
      log,
    },
  );
  if (!ready) {
    log('warning', `口袋商品区就绪诊断：${describePocketTabMiss()}`);
    return false;
  }
  return true;
}

async function ensurePocketProductsTab(log: AutomationLogSink): Promise<boolean> {
  // Content Script 就绪 ≠ Tab 已挂载；详情 SPA 冷开常见竞态（保守 25s）
  const tab = await waitRequiredValue(() => findPocketProductsTab(), {
    label: '口袋商品Tab',
    failureReason: '未找到「口袋商品/全部商品」Tab',
    timeoutMs: WaitTimeout.xlong,
    intervalMs: 250,
    log: log,
  });
  if (!tab) {
    log('warning', `口袋商品 Tab 诊断：${describePocketTabMiss()}`);
    return false;
  }

  if (isPocketTabActive(tab)) {
    return true;
  }

  clickElement(tab.closest(POCKET_TAB_CLICKABLE_CLOSEST) ?? tab);
  await delay('mid');

  const ready = await waitRequiredValue(
    () => {
      const current = findPocketProductsTab();
      if (current && isPocketTabActive(current)) return true;
      if (findProductSearchInput()) return true;
      return undefined;
    },
    {
      label: '口袋商品Tab就绪',
      failureReason: 'Tab 切换后搜索区未就绪',
      timeoutMs: WaitTimeout.default,
      intervalMs: 250,
      log: log,
    },
  );

  if (!ready) {
    log('warning', `口袋商品 Tab 就绪诊断：${describePocketTabMiss()}`);
  }

  return Boolean(ready);
}

/**
 * 找「口袋商品 / 全部商品」Tab（仅顶层文档直查）。
 * 实页为 tabs-header-item（无 role=tab）；只做 exact 文案，禁止 startsWith 以免点到整块商品卡。
 * CDP 实测口袋区只在顶层渲染：深扫同源 iframe/shadow 在此用不到已删除；
 * 跨域子帧（tbla-commodity-selector）由路由顶层断言 + 后台 frameId=0 隔离，不进此函数。
 */
function findPocketProductsTab(): Element | undefined {
  for (const label of POCKET_TAB_LABELS) {
    // 1) 实页主路径：tabs-header-item
    const byHeader = findVisibleExactLabel(label, POCKET_TAB_ITEM_SELECTOR);
    if (byHeader) {
      return byHeader.closest(POCKET_TAB_ITEM_SELECTOR) ?? byHeader;
    }

    // 2) 旧版 a11y：role=tab（精确文案）
    const byRole = findVisibleExactLabel(label, '[role="tab"]');
    if (byRole) {
      return byRole.closest('[role="tab"]') ?? byRole;
    }

    // 3) 可点控件精确文案（不含裸 span/div，避免命中 lak-space 外层）
    const byClickable = findVisibleExactLabel(label, 'button, a, [role="button"]');
    if (byClickable) {
      return byClickable.closest(POCKET_TAB_CLICKABLE_CLOSEST) ?? byClickable;
    }
  }

  return undefined;
}

function findVisibleExactLabel(label: string, selector: string): Element | undefined {
  const hit = findElementByText(label, { selector, exact: true });
  if (!hit || !isVisibleEnough(hit)) return undefined;
  if (!isExactPocketTabLabel(hit, label)) return undefined;
  return hit;
}

/** 文案必须与标签完全一致（去空白后），禁止 startsWith 误伤父容器。 */
function isExactPocketTabLabel(element: Element, label: string): boolean {
  const actual = normalizeVisibleText(element.textContent ?? '').replace(/\s+/g, '');
  const expected = normalizeVisibleText(label).replace(/\s+/g, '');
  return Boolean(expected) && actual === expected;
}

function describePocketTabMiss(): string {
  const href = typeof location !== 'undefined' ? location.href : '';
  let isTop = false;
  try {
    isTop = typeof window !== 'undefined' && window.self === window.top;
  } catch {
    isTop = false;
  }
  const headerTexts: string[] = [];
  for (const el of document.querySelectorAll(POCKET_TAB_ITEM_SELECTOR)) {
    if (!isVisibleEnough(el)) continue;
    const text = normalizeVisibleText(el.textContent ?? '')
      .replace(/\s+/g, '')
      .slice(0, 24);
    if (text) headerTexts.push(text);
  }
  const roleTabs: string[] = [];
  for (const el of document.querySelectorAll('[role="tab"]')) {
    if (!isVisibleEnough(el)) continue;
    const text = normalizeVisibleText(el.textContent ?? '')
      .replace(/\s+/g, '')
      .slice(0, 16);
    if (text) roleTabs.push(text);
  }
  const iframes = document.querySelectorAll('iframe').length;
  const hasSearch = Boolean(findProductSearchInput());
  return [
    `url=${href.slice(0, 120)}`,
    `isTop=${isTop ? '是' : '否'}`,
    `readyState=${document.readyState}`,
    `tabs-header-item=[${headerTexts.slice(0, 8).join('|') || '无'}]`,
    `role-tab=[${roleTabs.slice(0, 8).join('|') || '无'}]`,
    `iframe=${iframes}`,
    `searchInput=${hasSearch ? '有' : '无'}`,
  ].join(' · ');
}

function isPocketTabActive(element: Element): boolean {
  if (
    element.matches?.(POCKET_TAB_ITEM_SELECTOR) &&
    /active|selected|current/i.test(element.className?.toString() ?? '')
  ) {
    return true;
  }
  const selected =
    element.closest('[aria-selected="true"], .tbd-tabs-tab-active, [class*="active"]') ??
    (element.getAttribute('aria-selected') === 'true' ? element : null);
  return Boolean(selected) || isLikelyActiveTab(element);
}

function isLikelyActiveTab(element: Element): boolean {
  const cls = element.className?.toString() ?? '';
  if (/active|selected|current/i.test(cls)) return true;
  const parent = element.parentElement;
  if (parent && /active|selected/i.test(parent.className?.toString() ?? '')) return true;
  return element.getAttribute('aria-selected') === 'true';
}

/**
 * 将搜索框左侧维度下拉固定为「商品ID」。
 * 用户可能停留在「商品标题」等，直接填 ID 会搜不到。
 */
async function ensureProductIdSearchMode(
  log: AutomationLogSink,
): Promise<{ ok: boolean; detail: string }> {
  const input = await waitRequiredValue(() => findProductSearchInput(), {
    label: '口袋商品搜索框',
    failureReason: '未找到口袋商品搜索框，无法定位维度下拉',
    timeoutMs: WaitTimeout.long,
    intervalMs: 250,
    log: log,
  });
  if (!input) {
    return { ok: false, detail: '未找到口袋商品搜索框，无法定位维度下拉' };
  }

  const modeSelect = findProductSearchModeSelect(input);
  if (!modeSelect) {
    return {
      ok: false,
      detail: '未找到搜索框旁的维度下拉（期望展示「全部 / 商品ID / 商品标题」等）',
    };
  }

  if (isProductIdSearchMode(modeSelect)) {
    return {
      ok: true,
      detail: `搜索维度已是「${readSearchModeDisplay(modeSelect) || PRODUCT_ID_SEARCH_MODE}」，跳过`,
    };
  }

  const before = readSearchModeDisplay(modeSelect) || '(空)';
  const applied = await selectProductSearchMode(modeSelect, PRODUCT_ID_SEARCH_MODE);
  await delay('mid');

  if (applied.ok || isProductIdSearchMode(modeSelect)) {
    return {
      ok: true,
      detail: `已将搜索维度从「${before}」设为「${PRODUCT_ID_SEARCH_MODE}」（${applied.detail}）`,
    };
  }

  return {
    ok: false,
    detail: `原展示「${before}」，选择「${PRODUCT_ID_SEARCH_MODE}」失败：${applied.detail}`,
  };
}

function isProductIdSearchMode(scope: Element): boolean {
  const display = readSearchModeDisplay(scope);
  const compact = display.replace(/\s+/g, '');
  return (
    compact === '商品ID' ||
    compact === '商品id' ||
    tbdSelectDisplayMatches(scope, PRODUCT_ID_SEARCH_MODE) ||
    nextSelectDisplayMatches(scope, PRODUCT_ID_SEARCH_MODE) ||
    nextSelectDisplayMatches(scope, '商品id')
  );
}

function readSearchModeDisplay(scope: Element): string {
  return (
    readTbdSelectDisplay(scope) ||
    readNextSelectDisplay(scope) ||
    normalizeVisibleText(scope.textContent ?? '')
  );
}

async function selectProductSearchMode(
  scope: Element,
  optionText: string,
): Promise<{ ok: boolean; detail: string }> {
  // TBD / Ant Select（详情页口袋商品常见）
  if (findTbdSelectTrigger(scope) || findTbdSelectRoot(scope)) {
    const result = await selectTbdSelectOptionDetailed(scope, optionText);
    if (result.ok) return { ok: true, detail: result.detail || '已选中' };
    // 个别页面文案为「商品id」
    if (optionText === PRODUCT_ID_SEARCH_MODE) {
      const alt = await selectTbdSelectOptionDetailed(scope, '商品id');
      if (alt.ok) return { ok: true, detail: alt.detail || '已选中「商品id」' };
      return { ok: false, detail: `${result.detail}; ${alt.detail}` };
    }
    return { ok: false, detail: result.detail };
  }

  // Fusion next-select 兜底
  const nextRoot = findNextSelectRoot(scope) ?? (scope instanceof HTMLElement ? scope : undefined);
  if (nextRoot) {
    const result = await selectNextSelectOptionDetailed(nextRoot, optionText);
    if (result.ok) return { ok: true, detail: result.detail || '已选中' };
    if (optionText === PRODUCT_ID_SEARCH_MODE) {
      const alt = await selectNextSelectOptionDetailed(nextRoot, '商品id');
      if (alt.ok) return { ok: true, detail: alt.detail || '已选中「商品id」' };
      return { ok: false, detail: `${result.detail}; ${alt.detail}` };
    }
    return { ok: false, detail: result.detail };
  }

  return { ok: false, detail: '未识别到搜索维度下拉框' };
}

/**
 * 找搜索框左侧（或同行）的维度 Select。
 * 实页结构常见：[商品ID ▾] [输入对应内容…]
 */
function findProductSearchModeSelect(
  searchInput: HTMLInputElement | HTMLTextAreaElement,
): Element | undefined {
  const candidates = collectProductSearchModeSelects(searchInput);
  if (candidates.length === 0) return undefined;

  const inputRect = searchInput.getBoundingClientRect();

  const scored = candidates.map((el) => {
    const rect = el.getBoundingClientRect();
    const display = readSearchModeDisplay(el);
    const cls = el.className?.toString() ?? '';
    const exactMode = PRODUCT_SEARCH_MODE_HINTS.some((hint) => display === hint);
    // 「全部商品」筛选也会命中 includes「全部」，不能当维度下拉
    const softMode =
      !exactMode &&
      PRODUCT_SEARCH_MODE_HINTS.some((hint) => hint !== '全部' && display.includes(hint));
    const dx = inputRect.left - rect.right;
    const dy = Math.abs(rect.top - inputRect.top);
    // 优先：search-select 类名、精确维度文案、输入框左侧同行
    let score = 0;
    if (/search-select/i.test(cls)) score += 30;
    if (exactMode) score += 25;
    else if (softMode) score += 10;
    if (dx >= -12 && dx < 320) score += 15;
    if (dy < 48) score += 10;
    if (rect.left < inputRect.left) score += 5;
    return { el, score, dx, dy, display };
  });

  scored.sort((a, b) => b.score - a.score || a.dx - b.dx);
  return scored[0]?.el;
}

function collectProductSearchModeSelects(
  searchInput: HTMLInputElement | HTMLTextAreaElement,
): Element[] {
  const roots: Element[] = [];
  const seen = new Set<Element>();

  const push = (el: Element | null | undefined) => {
    if (!el || seen.has(el)) return;
    const tbd =
      findTbdSelectRoot(el) ??
      (el.matches?.('.tbd-select, .ant-select, .tbla-select, [class*="search-select"]')
        ? el
        : undefined);
    const next =
      findNextSelectRoot(el) ??
      (el instanceof HTMLElement && el.matches('.next-select') ? el : undefined);
    const root = tbd ?? next;
    if (!root || seen.has(root)) return;
    if (!isVisibleEnough(root)) return;
    if (/\bdropdown\b/i.test(root.className?.toString() ?? '')) return;
    seen.add(root);
    roots.push(root);
  };

  // 实页：维度 Select 在 input-group-addon 内（.tbla-select.search-select--*）
  const group = searchInput.closest(
    '.tbla-input-group-wrapper, .tbla-input-group, .ant-input-group-wrapper, .ant-input-group, [class*="search-input"]',
  );
  if (group) {
    for (const node of group.querySelectorAll(
      '.tbla-select, .tbd-select, .ant-select, [class*="search-select"]',
    )) {
      push(node);
    }
  }

  let walker: Element | null = searchInput.parentElement;
  for (let depth = 0; depth < 8 && walker; depth += 1) {
    for (const node of walker.querySelectorAll(
      '.tbla-select, .tbd-select, .ant-select, .next-select, [class*="search-select"], [class*="tbd-select-single"], [class*="ant-select-single"], [class*="tbla-select-single"]',
    )) {
      push(node);
    }
    for (const sibling of walker.parentElement?.children ?? []) {
      if (!(sibling instanceof Element) || sibling === walker) continue;
      push(
        sibling.querySelector(
          '.tbla-select, .tbd-select, .ant-select, .next-select, [class*="search-select"]',
        ) ?? sibling,
      );
    }
    walker = walker.parentElement;
  }

  // 兜底：展示值像搜索维度的可见 Select
  for (const node of queryAllDeep<Element>(
    '.tbla-select, .tbd-select, .ant-select, .next-select, [class*="search-select"], [class*="tbd-select-single"], [class*="tbla-select-single"]',
  )) {
    const display = readSearchModeDisplay(node);
    if (PRODUCT_SEARCH_MODE_HINTS.some((hint) => display === hint || display.includes(hint))) {
      push(node);
    }
  }

  return roots;
}

/**
 * 填入口袋商品 ID 搜索框（导出供「失败时回填错误现场」复用：
 * 多商品场景下最后一次搜索可能是成功商品的 ID，需回填首个失败商品 ID 再交给失败截图）。
 * 抗回滚：受控组件可能在数据水合重渲染时把合成值清掉（2026-09-24 记录 107），
 * 这里填后存活校验 + 重定位重填；失败诊断已由工具发进执行日志。
 */
export async function fillProductIdSearch(
  productId: string,
  log: AutomationLogSink,
): Promise<boolean> {
  const input = await waitRequiredValue(() => findProductSearchInput(), {
    label: '商品ID搜索框',
    failureReason: '口袋商品区搜索输入框未出现',
    timeoutMs: WaitTimeout.long,
    intervalMs: 250,
    log: log,
  });
  if (!input) return false;

  try {
    await fillAndVerifyTextResilient(input, productId, {
      label: '商品 ID 搜索框',
      // 页面可能对填入值做加工（加前后缀/空白），保留原 includes 判定口径
      match: 'includes',
      // 重渲染换节点后旧引用保值、回读会假通过：每轮重定位活节点
      relocate: () => findProductSearchInput(),
      log,
    });
    return true;
  } catch {
    return false;
  }
}

/** 清空商品 ID 搜索框，让列表恢复展示全部商品。 */
export async function clearProductIdSearch(
  ctx: PinHotProductOptions,
): Promise<{ ok: boolean; detail: string }> {
  const { log } = ctx;
  const input = await waitRequiredValue(() => findProductSearchInput(), {
    label: '商品搜索输入框',
    failureReason: '未找到商品搜索输入框',
    timeoutMs: WaitTimeout.default,
    intervalMs: 250,
    log,
  });
  if (!input) {
    return { ok: false, detail: '未找到商品搜索输入框' };
  }
  try {
    fillTextInput(input, '');
  } catch {
    // 受控组件异常时兜底直接清空并触发事件
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await delay('long');
  if (normalizeVisibleText(input.value).length === 0) {
    return { ok: true, detail: '已清空商品 ID 搜索，恢复完整商品列表' };
  }
  return { ok: false, detail: '已尝试清空，但搜索框仍有残留内容' };
}

/**
 * 口袋商品搜索框（仅顶层文档直查）。
 * CDP 实测：input[placeholder="输入对应内容搜索"] 就在顶层 document（非 shadow/iframe），
 * 类名 tbla-input，同组 .tbla-input-group 内 sibling 即维度下拉（商品ID）。
 */
function findProductSearchInput(): HTMLInputElement | HTMLTextAreaElement | undefined {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'),
  ).filter((input) => {
    if (
      input.disabled ||
      input.type === 'hidden' ||
      input.type === 'checkbox' ||
      input.type === 'radio'
    ) {
      return false;
    }
    if (!isVisibleEnough(input)) return false;
    const hint = normalizeVisibleText(
      [input.placeholder, input.getAttribute('aria-label'), input.name].filter(Boolean).join(' '),
    );
    return /输入对应内容|商品|ID|搜索|查询/i.test(hint) || hint.length === 0;
  });

  // 优先 placeholder「输入对应内容搜索」（口袋商品维度搜索框）
  const byPlaceholder = inputs.find((input) => /输入对应内容/.test(input.placeholder ?? ''));
  if (byPlaceholder) return byPlaceholder;

  // 在口袋商品区域附近的可见输入
  return (
    inputs.find((input) => {
      const rect = input.getBoundingClientRect();
      return rect.width > 40 && rect.top > 80;
    }) ?? inputs[0]
  );
}

async function waitForProductItem(
  productId: string,
  timeoutMs: number = WaitTimeout.default,
  log: AutomationLogSink,
): Promise<Element | undefined> {
  return waitRequiredValue(() => findProductItem(productId), {
    label: '口袋商品条目',
    failureReason: `未找到商品 ID「${productId}」对应条目`,
    timeoutMs,
    intervalMs: 300,
    log: log,
  });
}

function findProductItem(productId: string): Element | undefined {
  const escaped = CSS.escape(productId);
  const hit = queryAllDeep(`[data-item-id="${escaped}"]`)[0];
  return hit ?? document.querySelector(`[data-item-id="${escaped}"]`) ?? undefined;
}

/**
 * 商品行内「置顶相关图标」的互斥结局。
 * - action：出现可见置顶图标（baopinzhiding），可点击置顶；
 * - already-pinned：出现可见「取消置顶」图标（quXiaoZhiDing），商品已是爆品。
 */
type PinRowState = { state: 'action'; element: HTMLElement } | { state: 'already-pinned' };

/**
 * 等待商品行内图标「存在且可见」，以先出现者为准返回结局。
 * 偶发竞态下 `data-item-id` 条目先入 DOM、行内图标后完成布局（尺寸为 0 或被判定不可见），
 * 仅查一次会误报。此处用 `waitUntilLive`（MutationObserver + 轮询兜底）：
 * - 最小化后台执行时定时器被节流到 ≥1s，MutationObserver 微任务级响应更快；
 * - 内置轮询兜底，observer 不触发（如纯布局重排）也不会失败。
 * 每次轮询按 ID 重新定位条目，规避搜索重渲染时旧条目节点被替换的竞态。
 * 已置顶商品行内永远不会出现置顶图标 —— 与其先为置顶图标等满超时再兜底判断，
 * 不如把「取消置顶图标可见」作为同一次等待的直接结局，已置顶时可快速跳过；
 * 取消图标同样获得「存在且可见」的判定语义，隐藏残留节点不再干扰。
 */
async function waitForPinRowState(
  productId: string,
  timeoutMs: number = WaitTimeout.medium,
  _log: AutomationLogSink,
): Promise<PinRowState | undefined> {
  return waitUntilLive<PinRowState>(
    () => {
      const item = findProductItem(productId);
      if (!item) return undefined;
      const action = findPinAction(item);
      if (action) return { state: 'action', element: action };
      if (detectAlreadyPinned(item).pinned) return { state: 'already-pinned' };
      return undefined;
    },
    {
      timeoutMs,
      intervalMs: 250,
      observeRoot: findPocketListContainer(),
      attributeFilter: ['class', 'style'],
    },
  );
}

/**
 * 定位口袋商品列表容器作为 observer 锚点。
 * 首选 `#livePushed`（`div.list`）：CDP 实测为唯一列表容器，搜索重渲染时节点复用、不被替换，
 * 只增删内部商品卡片与 style 变化，observer 不会失效；且覆盖全部多商品卡片。
 * 兜底：任一 `data-item-id` 卡片的 closest 列表容器；再不行退化为 document.body。
 */
function findPocketListContainer(): ParentNode {
  const byId = document.querySelector('#livePushed');
  if (byId) return byId;
  const firstItem = document.querySelector('[data-item-id]');
  return firstItem?.closest('div.list') ?? document.body;
}

/**
 * 在商品条目及其父行内查找指定图标，要求「存在且可见」。
 * 有时 data-item-id 在子节点，行内图标在父行；两者都查。
 * 置顶与取消两种图标共用此查找，保持语义对称。
 */
function findRowIcon(item: Element, tblalogId: string): HTMLElement | undefined {
  const byLog = item.querySelector<HTMLElement>(`[data-tblalog-id="${tblalogId}"]`);
  if (byLog && isVisibleEnough(byLog)) return byLog;

  // 有时 data-item-id 在子节点，行内图标在父行
  const row = item.closest('[class*="item"], [class*="Item"], li, tr') ?? item.parentElement;
  if (row && row !== item) {
    const nested = row.querySelector<HTMLElement>(`[data-tblalog-id="${tblalogId}"]`);
    if (nested && isVisibleEnough(nested)) return nested;
  }

  return undefined;
}

function findPinAction(item: Element): HTMLElement | undefined {
  return findRowIcon(item, PIN_ACTION_LOG_ID);
}

/**
 * 商品行是否已处于爆品（置顶）状态：与 findPinAction 互斥的另一结局。
 * 实页中已置顶商品的行内会出现「取消置顶」图标（quXiaoZhiDing），
 * 命中「可见」的取消图标才视为已置顶 —— 隐藏残留节点（列表节点复用、搜索重渲染遗留）
 * 不计入，避免把未置顶商品误判跳过。
 * 不能用 `.tcl-item-action-top` class 判断 —— 它与 baopinzhiding 共用，
 * 既无法区分状态，又存在被误点为「取消爆品」的风险。
 */
function detectAlreadyPinned(item: Element): { pinned: boolean } {
  return { pinned: Boolean(findRowIcon(item, PIN_CANCEL_ACTION_LOG_ID)) };
}

/**
 * 处理置顶后的确认弹窗（状态机式轮询，点完 A 持续等可能跟随的 B）：
 * - 设置爆品：确定要设置x号宝贝为爆品宝贝吗？ → 点确定，随后等 B
 * - 二次确认（已达上限3 个）：爆品最多置顶3个…将替换当前置顶中的最后一个商品 → 点确定
 * - 取消爆品设置：商品已是爆品或被点了两次 → 点取消关掉，避免误取消
 * 判断顺序：先 B（全文精匹配）→ 再取消（收紧判定）→ 再 A。A 确认后若连续约 5s
 * 无任何爆品弹窗，视为本次置顶成功（无 B），正常返回。
 */
async function confirmSetHotProductModal(
  timeoutMs: number = WaitTimeout.long,
): Promise<{ ok: boolean; detail: string }> {
  const intervalMs = 250;
  const start = Date.now();
  let clickedSet = false;
  // A 确认后连续「无任何可见爆品弹窗」的轮询次数；连续够长才认为没有 B（正常成功）
  let idleAfterSet = 0;
  // A 关闭后给 B（服务端校验限流）留约 5s 缓冲窗口；B 出现即被拦截并点确定
  const idleThreshold = 20;

  while (Date.now() - start < timeoutMs) {
    // 一次性收集全部可见爆品弹窗。A 的 .tbla-modal-content 可能在 B 弹起后仍残留于 DOM
    // （仅被覆盖未移除），document.querySelectorAll 会先命中 A；故必须遍历全部并按优先级处理，
    // 否则 B 永远轮询不到 → 误判成功、B 遗留页面。
    const dialogs = findVisibleHotProductDialogs();

    if (dialogs.length > 0) {
      const texts = dialogs.map((d) => normalizeVisibleText(d.textContent ?? ''));

      // 优先级 1：替换上限 B（全文精匹配；其 textContent 含按钮「取 消」，须置于取消判定前）
      const bIndex = texts.findIndex(isReplaceLastHotProductDialog);
      if (bIndex >= 0) {
        const confirm = findDialogButton(dialogs[bIndex], ['确定', '确认']);
        if (confirm) {
          clickElement(confirm);
          return { ok: true, detail: '已达爆品上限3个，已确认替换最后一个爆品' };
        }
      }

      // 优先级 2：取消爆品设置（收紧判定：须含「爆品设置 / 确认取消」）
      const cancelIndex = texts.findIndex(isCancelHotProductDialog);
      if (cancelIndex >= 0) {
        const cancelBtn = findDialogButton(dialogs[cancelIndex], ['取消']);
        if (cancelBtn) clickElement(cancelBtn);
        return {
          ok: false,
          detail:
            '出现「取消爆品设置」确认框（商品可能已是爆品，或置顶被点了两次）。已点「取消」关闭弹窗，未取消爆品。',
        };
      }

      // 优先级 3：设置爆品 A
      const setIndex = texts.findIndex(isSetHotProductDialog);
      if (setIndex >= 0) {
        const confirm = findDialogButton(dialogs[setIndex], ['确定', '确认']);
        if (confirm && !clickedSet) {
          clickElement(confirm);
          clickedSet = true;
        }
      }
      idleAfterSet = 0;
    } else if (clickedSet) {
      // A 已确认且当前无弹窗：累计无弹窗轮次，超过缓冲窗口即视为正常成功（无 B）
      idleAfterSet += 1;
      if (idleAfterSet >= idleThreshold) {
        return { ok: true, detail: '已确认设置爆品' };
      }
    }

    await sleepMs(intervalMs);
  }

  // 超时兜底：首弹窗从未出现 → 失败；否则按已确认程度裁定
  if (clickedSet) {
    return { ok: true, detail: '已确认设置爆品' };
  }
  return { ok: false, detail: '已点击置顶，但未出现「设置爆品」确认弹窗' };
}

/** 清理页面遗留的「爆品/宝贝」确认弹窗（上个失败会话可能留下，会遮挡口袋商品 Tab / 搜索）。 */
async function dismissLeftoverHotProductDialogs(): Promise<void> {
  const dialogs = findVisibleHotProductDialogs();
  for (const dialog of dialogs) {
    const cancelBtn = findDialogButton(dialog, ['取消']);
    if (cancelBtn) clickElement(cancelBtn);
  }
  if (dialogs.length > 0) await delay('mid');
}

/** 收集全部可见的「爆品/宝贝」弹窗（可能同时存在 A 残留与 B）。
 *  容器仅取已确认的 Fusion modal（B 为 .tbla-modal-content）；不扫 message/toast 等非弹窗浮层，
 *  避免把「设置成功」提示误收入。 */
function findVisibleHotProductDialogs(): Element[] {
  const selectors = [
    '.tbla-modal-content',
    '[role="dialog"]',
    '.ant-modal-content',
    '.tbd-modal-content',
  ];
  const candidates = Array.from(document.querySelectorAll<Element>(selectors.join(',')));
  return candidates.filter((el) => {
    if (!isVisibleEnough(el)) return false;
    const text = normalizeVisibleText(el.textContent ?? '');
    return text.includes('爆品') || text.includes('宝贝');
  });
}

/** 已达爆品置顶上限3 个时的二次确认弹窗（点设置爆品「确定」后弹出），识别后点「确定」替换最后一个。 */
const REPLACE_LAST_HOT_PRODUCT_DIALOG_TEXT =
  '爆品最多置顶3个，继续操作，将替换当前置顶中的最后一个商品';

function isSetHotProductDialog(text: string): boolean {
  // 「设置…为爆品」；排除「取消…爆品设置」
  if (text.includes('取消') && text.includes('爆品')) return false;
  return (text.includes('设置') && text.includes('爆品')) || text.includes('为爆品');
}

function isCancelHotProductDialog(text: string): boolean {
  // 收紧判定：必须是「确定取消…爆品设置」类确认，避免「替换上限」弹窗因 textContent 含按钮
  // 「取 消」而被误判为取消爆品设置。B 弹窗正文为「…将替换当前置顶中的最后一个商品」。
  if (!text.includes('取消')) return false;
  return text.includes('爆品设置') || text.includes('取消爆品设置') || /确认\s*取消/.test(text);
}

/** 爆品置顶已达上限时的「替换最后一个」二次确认弹窗；按页面原文匹配（去空白后全文包含，弹窗 textContent 含标题/按钮文案）。 */
function isReplaceLastHotProductDialog(text: string): boolean {
  return text
    .replace(/\s+/g, '')
    .includes(REPLACE_LAST_HOT_PRODUCT_DIALOG_TEXT.replace(/\s+/g, ''));
}

function findDialogButton(dialog: Element, labels: string[]): Element | undefined {
  for (const el of dialog.querySelectorAll('button, [role="button"], a, span')) {
    const label = normalizeVisibleText(el.textContent ?? '').replace(/\s+/g, '');
    if (labels.some((want) => label === want.replace(/\s+/g, ''))) {
      return el.closest('button, [role="button"], a') ?? el;
    }
  }
  for (const want of labels) {
    const found = findClickableByText(want, dialog);
    if (found) return found;
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
