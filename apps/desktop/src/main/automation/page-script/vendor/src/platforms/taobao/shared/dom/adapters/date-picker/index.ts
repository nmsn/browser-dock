/**
 * TBD / Fusion(next) / Ant Design 日期时间面板选择适配器。
 *
 * C47 闪降「选择时间」为 Fusion next-date-picker（CDP 实页验证）：
 *   1) 点触发器打开面板：日期表 + footer（「选择时间」「确定」）
 *   2) 选日期格 td.next-calendar-cell[title="YYYY-MM-DD"]
 *   3) 点 footer「选择时间」→ 切换到时间面板（时/分/秒三列）
 *   4) 点 li.next-time-picker-menu-item[title="<值>"] 选时分秒
 *   5) 点 footer「确定」提交并收起
 * 输入框 readonly，文本直接赋值无效，必须走面板。
 */
import {
  clickElement,
  findElementByText,
  normalizeVisibleText,
} from '../../../../../../shared/automation/dom-actions';
import { delay } from '../../../../../../shared/automation/delay';
import { formatDuration } from '../../../../../../shared/automation/format-duration';
import { waitUntil, WaitTimeout } from '../../../../../../shared/automation/wait';

export type DateTimePanelSelectResult = {
  ok: boolean;
  detail: string;
};

export type DateTimePanelSelectOptions = {
  /** 点击输入框后面板就绪的最大等待；超时按「面板不可用」快速退回，避免 5s/次 × 多次重试。默认 WaitTimeout.medium */
  bodyTimeoutMs?: number;
  /** 阶段耗时/诊断回调（透传 addLog('info', …) 即可显示在侧栏执行日志） */
  log?: (message: string) => void;
};

export type ParsedDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const DATE_PICKER_BODY_SELECTORS = [
  '.next-date-picker-body:not([aria-hidden="true"])',
  '.next-date-picker-body:not([style*="display: none"])',
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  '.ant-picker-dropdown:not([style*="display: none"])',
].join(', ');

const CHINESE_MONTHS = ['', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

/**
 * 打开输入框 → 选日期 → 「选择时间」→ 选时分秒 → 「确定」。
 */
export async function selectDateTimeInPickerPanel(
  input: HTMLInputElement,
  value: string,
  root: ParentNode = document,
  options: DateTimePanelSelectOptions = {},
): Promise<DateTimePanelSelectResult> {
  const { bodyTimeoutMs = WaitTimeout.medium, log } = options;
  const startedAt = Date.now();
  const logElapsed = (label: string) => {
    log?.(`[时间面板] ${label}：${formatDuration(Date.now() - startedAt)}`);
  };

  const parsed = parseDateTimeValue(value);
  if (!parsed) {
    return {
      ok: false,
      detail: `无法解析开始时间「${value}」（期望 YYYY-MM-DD HH:mm:ss）`,
    };
  }

  // 输入框已命中目标值时跳过整段面板流程：重试轮里第一次写完值后，
  // 面板未关或校验只差「确定」时避免把 2-3s 的打开/选择再走一遍。
  const preValue = normalizeVisibleText(input.value ?? '');
  if (verifyDateTimeValue(preValue, value)) {
    const openBody = findPickerBody(root);
    if (openBody) {
      await clickFooterButton(root, '确定').catch(() => false);
      await delay('tick');
    }
    logElapsed('值已命中，跳过面板');
    return { ok: true, detail: `输入框已为「${value}」，跳过面板选择` };
  }

  // 不清除预填值：清除后 Fusion 会退化成「仅日期」模式，时间项无法选择、面板提前关闭。
  // 「提前暴露问题」靠末尾精确校验：时间未命中时最终值≠目标值，校验必失败。
  let body = findPickerBody(root);
  if (body) {
    logElapsed('复用已打开面板');
  } else {
    const trigger = input.closest('.next-date-picker-trigger, .next-date-picker, .ant-picker')
      ?? input;
    clickElement(trigger instanceof Element ? trigger : input);
    input.focus();
    // 面板就绪交给 waitForPickerBody 的 200ms 轮询判定，这里不用整段 200-450ms 空等
    await delay('tick');

    body = await waitForPickerBody(root, bodyTimeoutMs);
    logElapsed('打开面板');
    if (!body) {
      return { ok: false, detail: '点击时间输入框后未出现日期时间面板' };
    }
  }

  const dateOk = await selectDateCell(body, parsed, root);
  if (!dateOk.ok) {
    logElapsed('选日期失败');
    return dateOk;
  }
  await delay('short');
  logElapsed('选日期');

  // 每步重新查询当前面板，避免拿到旧/遗留面板（重复运行时可能叠加多个）
  body = findPickerBody(root) ?? body;
  // 切到时间面板（已在时间面板则跳过）
  if (!body.querySelector('.next-date-picker-body-show-time')) {
    if (!(await clickFooterButton(root, '选择时间'))) {
      logElapsed('切时间面板失败');
      return { ok: false, detail: '选完日期后未找到「选择时间」按钮' };
    }
    await delay('short');
  }
  logElapsed('切到时间面板');

  body = findPickerBody(root) ?? body;
  const timeOk = await selectTimeCells(body, parsed);
  if (!timeOk.ok) {
    logElapsed('选时间失败');
    return timeOk;
  }
  await delay('short');
  logElapsed('选时/分/秒');

  // 值在选完时分秒后已写入输入框（CDP 验证）；「确定」仅用于收起面板
  const committed = normalizeVisibleText(input.value ?? '');
  if (verifyDateTimeValue(committed, value)) {
    await clickFooterButton(root, '确定').catch(() => false);
    // 面板收起让位给外层校验，无需再整段 200-450ms 空等
    await delay('tick');
    logElapsed('提交确定');
    return { ok: true, detail: `已在面板选择开始时间：${value}` };
  }

  if (!(await clickFooterButton(root, '确定'))) {
    logElapsed('未找到确定按钮');
    return {
      ok: false,
      detail: `已选日期与时间，但未找到面板「确定」按钮。${describePanelState(root)}`,
    };
  }
  await delay('tick');

  // 校验最终值必须命中目标日期时间，避免部分未选中却带残留值蒙混过关
  const actual = normalizeVisibleText(input.value ?? '');
  if (!verifyDateTimeValue(actual, value)) {
    logElapsed('提交后校验不通过');
    return {
      ok: false,
      detail: `面板选择后输入框为「${actual || '(空)'}」，与目标「${value}」不一致`,
    };
  }
  logElapsed('提交确定(二次校验)');
  return { ok: true, detail: `已在面板选择开始时间：${value}` };
}

/** 校验输入框值是否命中目标日期时间（兼容 / 与 - 分隔；秒可缺省，只比较 时:分）。 */
function verifyDateTimeValue(actual: string, target: string): boolean {
  if (!actual || !target) return false;
  const norm = (value: string) => value.replace(/[-\/]/g, '-').replace(/\s+/g, ' ').trim();
  const a = norm(actual);
  const t = norm(target);
  if (a === t || a.includes(t) || t.includes(a)) return true;
  const aDate = /^\d{4}-\d{1,2}-\d{1,2}/.exec(a)?.[0];
  const tDate = /^\d{4}-\d{1,2}-\d{1,2}/.exec(t)?.[0];
  const aTime = /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(a);
  const tTime = /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(t);
  if (!aDate || !tDate || !aTime || !tTime) return false;
  return aDate === tDate && aTime[1] === tTime[1] && aTime[2] === tTime[2];
}

/** 解析 YYYY-MM-DD HH:mm:ss（或带 / 的变体）。 */
export function parseDateTimeValue(value: string): ParsedDateTime | undefined {
  const m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!m) return undefined;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] ?? '0'),
  };
}

async function waitForPickerBody(
  root: ParentNode,
  timeoutMs: number,
): Promise<Element | undefined> {
  return waitUntil(() => findPickerBody(root), { timeoutMs, intervalMs: 200 });
}

function findPickerBody(root: ParentNode): Element | undefined {
  const searchRoots: ParentNode[] = root && root !== document ? [root, document] : [document];
  // 取最后一个可见面板（后挂载的为当前打开的面板），避免命中历史遗留面板
  for (const searchRoot of searchRoots) {
    const found: HTMLElement[] = [];
    for (const selector of DATE_PICKER_BODY_SELECTORS.split(', ')) {
      const nodes = searchRoot.querySelectorAll<HTMLElement>(selector);
      for (const el of nodes) {
        if (!isVisibleEl(el)) continue;
        if (el.getAttribute('aria-hidden') === 'true') continue;
        found.push(el);
      }
    }
    if (found.length > 0) return found[found.length - 1];
  }
  return undefined;
}

/** 在日期表选目标日；跨月/跨年自动翻页。 */
async function selectDateCell(
  body: Element,
  target: ParsedDateTime,
  root: ParentNode,
): Promise<DateTimePanelSelectResult> {
  const targetTitle = `${target.year}-${String(target.month).padStart(2, '0')}-${String(target.day).padStart(2, '0')}`;

  for (let guard = 0; guard < 24; guard += 1) {
    const cell = findDateCell(body, targetTitle);
    if (cell) {
      const inner = cell.querySelector<HTMLElement>('.next-calendar-date, .ant-picker-cell-inner')
        ?? (cell instanceof HTMLElement ? cell : undefined);
      if (inner) {
        clickElement(inner);
        await delay('short');
        return { ok: true, detail: `已选日期 ${targetTitle}` };
      }
      return { ok: false, detail: `日期面板找到目标 cell 但无可点内层：${targetTitle}` };
    }

    const cur = readPanelMonth(body);
    if (cur && (cur.year !== target.year || cur.month !== target.month)) {
      const dir = compareYearMonth(cur, target);
      if (!clickMonthNav(body, dir)) {
        return { ok: false, detail: `目标日期 ${targetTitle} 不在当前面板且无法翻${dir === 'prev' ? '前' : '后'}月` };
      }
    } else if (cur === undefined) {
      return { ok: false, detail: `目标日期 ${targetTitle} 不在面板可见日（且无法读取面板月份）` };
    } else {
      return { ok: false, detail: `目标日期 ${targetTitle} 不在面板可见日（当前 ${cur.year}-${cur.month}）` };
    }
    await delay('mid');
  }

  return { ok: false, detail: `翻页超过 24 次仍未找到日期 ${targetTitle}` };
}

function findDateCell(body: Element, targetTitle: string): Element | undefined {
  const cells = body.querySelectorAll<HTMLElement>(
    '.next-calendar-cell, .ant-picker-cell, td, [role="gridcell"]',
  );
  for (const cell of cells) {
    if (!isVisibleEl(cell)) continue;
    if (cell.getAttribute('title') === targetTitle) return cell;
    const attr = cell.getAttribute('data-date') ?? cell.getAttribute('data-cell')
      ?? cell.getAttribute('data-full') ?? cell.getAttribute('data-value');
    if (attr && attr.startsWith(targetTitle)) return cell;
  }
  return undefined;
}

type YearMonth = { year: number; month: number };

/** 读面板当前年月；Fusion header 形如「八月2026」。读不到返回 undefined。 */
function readPanelMonth(body: Element): YearMonth | undefined {
  const view = body.querySelector<HTMLElement>('.next-calendar-panel-header-full, .next-calendar-header, .ant-picker-header-view');
  const text = normalizeVisibleText(view?.textContent ?? '');
  const yearMatch = /(\d{4})/.exec(text);
  let month: number | undefined;
  for (let i = 1; i <= 12; i += 1) {
    if (text.includes(CHINESE_MONTHS[i])) { month = i; break; }
  }
  const monthDigit = /(\d{1,2})月/.exec(text);
  if (month === undefined && monthDigit) month = Number(monthDigit[1]);
  if (!yearMatch || month === undefined) return undefined;
  return { year: Number(yearMatch[1]), month };
}

function compareYearMonth(cur: YearMonth, target: ParsedDateTime): 'prev' | 'next' {
  if (target.year < cur.year || (target.year === cur.year && target.month < cur.month)) return 'prev';
  return 'next';
}

function clickMonthNav(body: Element, dir: 'prev' | 'next'): boolean {
  const selector = dir === 'prev'
    ? '.next-calendar-btn-prev-month, .ant-picker-header-prev-btn'
    : '.next-calendar-btn-next-month, .ant-picker-header-next-btn';
  const btn = body.querySelector<HTMLElement>(selector);
  if (!btn || !isVisibleEl(btn)) return false;
  clickElement(btn);
  return true;
}

/** 在时间面板按时/分/秒三列点选。 */
async function selectTimeCells(
  body: Element,
  target: ParsedDateTime,
): Promise<DateTimePanelSelectResult> {
  const menus = Array.from(body.querySelectorAll<HTMLElement>('.next-time-picker-menu'));
  if (menus.length === 0) {
    // Ant 兜底：时间列
    const columns = Array.from(body.querySelectorAll<HTMLElement>('.ant-picker-time-panel-column'));
    if (columns.length >= 2) {
      const values = [target.hour, target.minute, target.second];
      for (let i = 0; i < Math.min(columns.length, values.length); i += 1) {
        if (!clickAntTimeCell(columns[i], String(values[i]))) {
          return { ok: false, detail: `时间第 ${i + 1} 列（${values[i]}）未选中` };
        }
        await delay('short');
      }
      return { ok: true, detail: '已在时间列选完时分' };
    }
    return { ok: false, detail: '时间面板未找到时/分/秒菜单' };
  }

  const titles = ['时', '分', '秒'];
  const values = [target.hour, target.minute, target.second];
  for (let i = 0; i < Math.min(menus.length, 3); i += 1) {
    const menu = menus[i];
    if (!isVisibleEl(menu)) continue;
    const title = normalizeVisibleText(
      menu.querySelector('.next-time-picker-menu-title')?.textContent ?? titles[i],
    );
    const item = findTimeMenuItem(menu, values[i]);
    if (!item) {
      return { ok: false, detail: `时间「${title}」=${values[i]} 未找到可选项` };
    }
    // 不能先 scrollIntoView：滚动会触发菜单重排，缓存节点失效导致点击落空（CDP 已验证）
    clickTimeMenuItem(item);
    await delay('short');
  }
  return { ok: true, detail: `已选时间 ${target.hour}:${target.minute}:${target.second}` };
}

/** 在时间菜单里按值找项，兼容 title 为「5」或补零「05」两种写法。 */
function findTimeMenuItem(menu: Element, value: number): HTMLElement | undefined {
  const raw = String(value);
  const padded = raw.padStart(2, '0');
  const selector = `li.next-time-picker-menu-item[title="${raw}"], li.next-time-picker-menu-item[title="${padded}"]`;
  const hit = menu.querySelector<HTMLElement>(selector);
  if (hit) return hit;
  // 个别实现不带 title：按文本回退
  for (const li of menu.querySelectorAll<HTMLElement>('li.next-time-picker-menu-item')) {
    const text = normalizeVisibleText(li.textContent ?? '');
    if (text === raw || text === padded) return li;
  }
  return undefined;
}

/** 时间菜单项直接合成 click（不走 scrollIntoView，避免 Fusion 重排后节点失效）。 */
function clickTimeMenuItem(item: HTMLElement): void {
  item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  if (typeof item.click === 'function') item.click();
}

function clickAntTimeCell(column: Element, value: string): boolean {
  const padded = value.padStart(2, '0');
  const unpadded = String(parseInt(value, 10));
  for (const cell of column.querySelectorAll<HTMLElement>('.ant-picker-time-panel-cell')) {
    const inner = cell.querySelector<HTMLElement>('.ant-picker-time-panel-cell-inner');
    const text = normalizeVisibleText(inner?.textContent ?? '');
    if (text !== padded && text !== unpadded && text !== value) continue;
    const target = inner ?? cell;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    clickElement(target);
    return true;
  }
  return false;
}

/** 在当前面板 footer 找指定文案按钮并点击；重新查询面板，避免缓存/遗留节点失效。 */
async function clickFooterButton(
  root: ParentNode,
  text: string,
  retries: number = 3,
): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const body = findPickerBody(root) ?? (root instanceof Element ? root : undefined);
    // 面板内优先；不强制 isVisibleEl（动画/定位瞬间 rect 可能为 0）
    const scope = body ?? document;
    if (clickButtonByText(scope, text)) return true;
    if (body && clickButtonByText(document, text)) return true;
    await delay('short');
  }
  return false;
}

function clickButtonByText(scope: ParentNode, text: string): boolean {
  const want = normalizeVisibleText(text);
  const buttons = scope.querySelectorAll<HTMLElement>('button, [role="button"]');
  for (const btn of buttons) {
    if (!(btn instanceof HTMLElement)) continue;
    if (normalizeVisibleText(btn.textContent ?? '') !== want) continue;
    clickElement(btn);
    return true;
  }
  const byText = findElementByText(text, {
    root: scope,
    selector: 'button, [role="button"]',
    exact: true,
  });
  if (byText instanceof HTMLElement) {
    clickElement(byText.closest('button, [role="button"]') ?? byText);
    return true;
  }
  return false;
}

/** 诊断：列出当前可见面板及其按钮，便于定位「确定」找不到的原因。 */
function describePanelState(root: ParentNode): string {
  const body = findPickerBody(root);
  if (!body) {
    return '未找到日期时间面板（面板可能已关闭）';
  }
  const cls = String(body.className).slice(0, 60);
  const buttons = Array.from(body.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .map((b) => {
      const r = b.getBoundingClientRect();
      return `${(b.textContent || '').trim().slice(0, 6) || '(空)'}[${Math.round(r.width)}x${Math.round(r.height)}]`;
    })
    .join(' | ');
  const footer = body.querySelector('.next-date-picker-panel-footer');
  return `面板class=${cls}；footer=${footer ? '有' : '无'}；按钮=[${buttons || '无'}]`;
}

function isVisibleEl(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
