import {
  clickElement,
  findElementByText,
  normalizeVisibleText,
} from '../../../../../shared/automation/dom-actions';
import { selectCascaderPathNearLabel } from '../../../shared/dom/adapters/cascader/next-ant-cascader';
import { findSelectAmongNextSiblings, fireSelectOpen } from '../../../shared/dom/adapters/select/next-fusion-shared';
import { findClickableByText } from '../../../shared/dom/finders';
import { selectOptionNearLabel } from '../../../shared/dom/form-options';
import { delay } from '../../../../../shared/automation/delay';
import { waitUntil, WaitTimeout } from '../../../../../shared/automation/wait';
import { describeDomRoots, queryAllDeep } from '../../../shared/dom/deep-dom';
import { isUnlimitedClaimPath } from '../../../shared/claim-condition';

/**
 * browser-dock 移植版：
 * 原扩展通过 MAIN world 网络钩子捕获券列表（coupon-list-capture.ts）；
 * 此处改为由主进程经 CDP 捕获响应并抽取行后作为参数传入。
 */
export type CapturedCouponRow = {
  /** 与底表「优惠券ID」对应的 templateId（feature 串里） */
  templateId: string;
  /** 响应里的名称字段候选（用于在 DOM 中定位行） */
  name?: string;
  /** 在列表响应中的出现顺序（兜底定位） */
  order: number;
};

export type PrepareOwnBenefitResult = {
  ok: boolean;
  detail: string;
  ownBenefitOpened: boolean;
  /** 当前 frame 已能按名称找到券行（同域列表） */
  listReadyInFrame: boolean;
  /** 权益列表在跨域 smf iframe，需主进程切换会话投递 */
  needsBenefitSelectFrame: boolean;
};

export type SelectCouponResult = {
  ok: boolean;
  detail: string;
  benefitSelected: boolean;
};

export type FinishCouponOptionsResult = {
  ok: boolean;
  detail: string;
  benefitConfirmed: boolean;
  claimUnlimited: boolean;
  claimConditionSet: boolean;
  channelUnlimited: boolean;
};

export type PushCouponAndCloseResult = {
  ok: boolean;
  detail: string;
  pushClicked: boolean;
  pushConfirmed: boolean;
  dialogClosed: boolean;
};

export type FillCouponDialogResult = {
  ok: boolean;
  detail: string;
  benefitSelected: boolean;
  claimUnlimited: boolean;
  claimConditionSet: boolean;
  channelUnlimited: boolean;
  pushClicked?: boolean;
  pushConfirmed?: boolean;
  dialogClosed?: boolean;
};

/**
 * 点「自有权益&授权的权益」，等待本 frame 出现券行或 smf 选券 iframe。
 */
export async function prepareOwnBenefit(): Promise<PrepareOwnBenefitResult> {
  const base: PrepareOwnBenefitResult = {
    ok: false,
    detail: '',
    ownBenefitOpened: false,
    listReadyInFrame: false,
    needsBenefitSelectFrame: false,
  };

  const ownBenefit = await waitForClickableTexts(
    ['自有权益&授权的权益', '自有权益及授权的权益', '自有权益'],
  );
  if (!ownBenefit) {
    return {
      ...base,
      detail: `未找到「自有权益&授权的权益」。${describeDomRoots()}`,
    };
  }
  clickElement(ownBenefit.closest('button, [role="button"], a, div') ?? ownBenefit);

  const listReady = await waitUntil(() => {
    if (hasAnyCouponRow()) {
      return {
        ok: true,
        detail: '已打开自有权益，当前 frame 可见券列表',
        ownBenefitOpened: true,
        listReadyInFrame: true,
        needsBenefitSelectFrame: false,
      } satisfies PrepareOwnBenefitResult;
    }
    if (hasBenefitSelectIframe()) {
      return {
        ok: true,
        detail: `已打开自有权益，券列表在跨域 iframe。${describeBenefitIframes()}`,
        ownBenefitOpened: true,
        listReadyInFrame: false,
        needsBenefitSelectFrame: true,
      } satisfies PrepareOwnBenefitResult;
    }
    return undefined;
  }, { timeoutMs: WaitTimeout.default, intervalMs: 300 });

  if (listReady) {
    return listReady;
  }

  if (hasBenefitSelectIframe()) {
    return {
      ok: true,
      detail: `已打开自有权益，券列表在跨域 iframe。${describeBenefitIframes()}`,
      ownBenefitOpened: true,
      listReadyInFrame: false,
      needsBenefitSelectFrame: true,
    };
  }

  return {
    ...base,
    ownBenefitOpened: true,
    detail: `已点自有权益，但未见券行也未见 awardBenefitSelect iframe。${describeDomRoots()}`,
  };
}

/**
 * 在当前 frame（通常是 smf awardBenefitSelect）按名称/渠道全等选 radio。
 * **不点 OK**（OK 在外层权益设置弹窗）。
 */
export async function selectCouponByName(couponName: string): Promise<SelectCouponResult> {
  const want = normalizeVisibleText(couponName);
  if (!want) {
    return { ok: false, detail: '优惠券名称不能为空', benefitSelected: false };
  }

  const row = await waitForCouponRow(want);
  if (!row) {
    return {
      ok: false,
      detail: `未找到名称/渠道全等为「${want}」的优惠券行。${probeCouponNames()}${describeDomRoots()}`,
      benefitSelected: false,
    };
  }

  const clicked = await clickCouponRowRadio(row, want);
  if (!clicked.ok) return clicked;
  return {
    ok: true,
    detail: `已勾选优惠券「${want}」（待外层 OK）`,
    benefitSelected: true,
  };
}

/**
 * 按优惠券 ID 精确选券。
 * 页面不渲染优惠券ID；由主进程从列表接口响应中抽取 rows 后传入，
 * 命中后按响应中的名称（或列表顺序）定位页面行并勾选 radio。
 */
export async function selectCouponById(
  couponId: string,
  capturedRows: CapturedCouponRow[],
): Promise<SelectCouponResult> {
  const want = couponId.trim();
  if (!want) {
    return { ok: false, detail: '优惠券ID不能为空', benefitSelected: false };
  }

  const entry = capturedRows.find((row) => row.templateId === want);
  if (!entry) {
    return {
      ok: false,
      detail: `主进程捕获的列表接口响应中无优惠券ID「${want}」。${describeCapturedCouponIds(capturedRows)}${describeDomRoots()}`,
      benefitSelected: false,
    };
  }

  // 按捕获到的名称在 DOM 定位行；名称为空时按列表顺序兜底
  const byName = entry.name
    ? await waitForCouponRow(normalizeVisibleText(entry.name), WaitTimeout.default)
    : undefined;
  const row = byName ?? (await waitForCouponRowByOrder(entry.order));
  if (!row) {
    return {
      ok: false,
      detail: `优惠券ID「${want}」已在列表接口响应中命中，但未在页面列表中定位到对应行（name=${entry.name ?? '(n/a)'}，order=${entry.order}）。${describeDomRoots()}`,
      benefitSelected: false,
    };
  }

  const clicked = await clickCouponRowRadio(row, want);
  if (!clicked.ok) return clicked;
  return {
    ...clicked,
    detail: `已按优惠券ID「${want}」勾选优惠券（templateId=${entry.templateId}）`,
  };
}

/** 勾选行内 radio（Fusion next-radio）并等待点中。 */
async function clickCouponRowRadio(
  row: HTMLElement,
  hint: string,
): Promise<SelectCouponResult> {
  const radio =
    row.querySelector<HTMLInputElement>('input.next-radio-input, input[type="radio"]')
    ?? row.querySelector<HTMLElement>('.next-radio-wrapper, .next-radio, label');
  if (!radio) {
    return {
      ok: false,
      detail: `找到优惠券行但无 radio：${hint}`,
      benefitSelected: false,
    };
  }

  clickElement(radio);
  await delay('mid');
  return { ok: true, benefitSelected: true, detail: '' };
}

function describeCapturedCouponIds(rows: CapturedCouponRow[]): string {
  if (rows.length === 0) {
    return '主进程尚未捕获到选券列表接口响应（可能未触发加载，或加载先于 Network.enable）。';
  }
  const preview = rows
    .slice(0, 10)
    .map((row) => `${row.templateId}${row.name ? `(${row.name})` : ''}`)
    .join(' | ');
  return `已捕获优惠券ID=[${preview}]。`;
}

function findCouponRowByOrder(order: number): HTMLElement | undefined {
  let index = 0;
  const rows = queryAllDeep<HTMLElement>(
    'tr, .next-table-row, .next-table-body .next-table-row, [data-next-table-row]',
  );
  for (const row of rows) {
    if (!isVisibleEl(row)) continue;
    const name = extractRowCouponName(row);
    if (!name || name === '名称/渠道') continue;
    if (index === order) return row;
    index += 1;
  }
  return undefined;
}

async function waitForCouponRowByOrder(
  order: number,
  timeoutMs: number = WaitTimeout.default,
): Promise<HTMLElement | undefined> {
  return waitUntil(() => findCouponRowByOrder(order), { timeoutMs, intervalMs: 300 });
}

/**
 * 外层弹窗：OK/确定 → 按路径设领取条件 → 投放渠道不限。
 * 若权益弹窗已关（无 OK）但领取条件控件可见，视为已确认选券，继续设条件。
 */
export async function confirmBenefitOkAndUnlimited(
  claimConditionPath: string[] = ['不限'],
): Promise<FinishCouponOptionsResult> {
  const path = claimConditionPath.map((part) => normalizeVisibleText(part)).filter(Boolean);
  const pathLabel = path.join(' / ') || '不限';
  const base: FinishCouponOptionsResult = {
    ok: false,
    detail: '',
    benefitConfirmed: false,
    claimUnlimited: false,
    claimConditionSet: false,
    channelUnlimited: false,
  };

  const okBtn = await waitForOkButton(WaitTimeout.short);
  if (okBtn) {
    clickElement(okBtn);
    await delay('long');
    base.benefitConfirmed = true;
  } else {
    // 选券后外层 OK 可能已点过，或弹窗已关；领取条件可见则继续
    const claimVisible = Boolean(
      findElementByText('领取条件', { selector: 'label, span, div, p', exact: true })
      ?? findElementByText('领取条件', { selector: '.alp-dl-label, label, span, div', exact: false }),
    );
    if (!claimVisible) {
      return {
        ...base,
        detail: `未找到权益设置弹窗 OK/确定 按钮，且未见「领取条件」。${describeDomRoots()}`,
      };
    }
    base.benefitConfirmed = true;
  }

  const claim = await selectCascaderPathNearLabel(['领取条件'], path.length ? path : ['不限']);
  base.claimConditionSet = claim.ok;
  base.claimUnlimited = claim.ok && isUnlimitedClaimPath(path);
  if (!claim.ok) {
    return {
      ...base,
      detail: `已确认选券，但未能将「领取条件」设为「${pathLabel}」。${claim.detail}${describeDomRoots()}`,
    };
  }

  const channelOk = await selectUnlimitedByLabel('投放渠道');
  base.channelUnlimited = channelOk;
  if (!channelOk) {
    return {
      ...base,
      detail: `领取条件「${pathLabel}」已设，但未能将「投放渠道」设为不限。${describeDomRoots()}`,
    };
  }

  return {
    ...base,
    ok: true,
    claimConditionSet: true,
    detail: `已确认选券，领取条件「${pathLabel}」，投放渠道不限`,
  };
}

/**
 * 点「投放」→ 二次确认「已检查完成，确认投放」→ 关外层「优惠券红包」弹窗 X。
 */
export async function pushCouponAndCloseDialog(): Promise<PushCouponAndCloseResult> {
  const base: PushCouponAndCloseResult = {
    ok: false,
    detail: '',
    pushClicked: false,
    pushConfirmed: false,
    dialogClosed: false,
  };

  await ensureServiceAgreementChecked();

  const launchBtn = await waitForLaunchButton();
  if (!launchBtn) {
    return {
      ...base,
      detail: `未找到「投放」按钮（实页文案可能为「投 放」）。${describeDomRoots()}`,
    };
  }
  clickElement(launchBtn);
  base.pushClicked = true;

  const confirmBtn = await waitForExactButton('已检查完成，确认投放');
  if (!confirmBtn) {
    return {
      ...base,
      detail: `已点投放，但未找到二次确认「已检查完成，确认投放」。${describeDomRoots()}`,
    };
  }
  clickElement(confirmBtn);
  await delay('long');

  // 若确认弹窗仍在，再点一次
  const stillConfirm = findExactButton('已检查完成，确认投放');
  if (stillConfirm) {
    clickElement(stillConfirm);
    await delay('mid');
  }
  base.pushConfirmed = true;

  // 关闭 X（ant-modal-close）在直播详情顶层壳，不在本 coupon iframe 内
  return {
    ...base,
    ok: true,
    dialogClosed: false,
    detail: '已投放并确认；待顶层点击 ant-modal-close 关闭弹窗',
  };
}

/**
 * 在直播详情顶层关闭「优惠券红包」壳：
 * `<button aria-label="Close" class="ant-modal-close">…`
 */
export async function closeCouponShellDialog(): Promise<{
  ok: boolean;
  detail: string;
  dialogClosed: boolean;
}> {
  const closedDuringWait = await waitUntil(() => {
    const closeBtn = findCouponModalCloseButton();
    if (!closeBtn) {
      if (!hasLiveCouponIframe()) {
        return { ok: true, detail: '优惠券红包弹窗已关闭', dialogClosed: true };
      }
      return undefined;
    }

    clickElement(closeBtn);
    if (!findCouponModalCloseButton() && !hasLiveCouponIframe()) {
      return { ok: true, detail: '已点击 ant-modal-close 关闭优惠券红包弹窗', dialogClosed: true };
    }
    return undefined;
  }, { timeoutMs: WaitTimeout.default, intervalMs: 600 });

  if (closedDuringWait) return closedDuringWait;

  const stillClose = findCouponModalCloseButton();
  if (stillClose) {
    clickElement(stillClose);
    await delay('mid');
  }

  const closed = !hasLiveCouponIframe() && !findCouponModalCloseButton();
  return closed
    ? { ok: true, detail: '已关闭优惠券红包弹窗', dialogClosed: true }
    : {
        ok: false,
        detail: `未点到/未关掉 ant-modal-close（aria-label=Close）。${describeDomRoots()}`,
        dialogClosed: false,
      };
}

function hasLiveCouponIframe(): boolean {
  return Array.from(document.querySelectorAll('iframe')).some((frame) => {
    const src = frame.getAttribute('src') || frame.src || '';
    return src.includes('app-live-platform-live-coupon') || src.includes('live-coupon');
  });
}

/** 实页关闭钮：button.ant-modal-close[aria-label=Close]，优先绑在含 coupon iframe 的 modal */
function findCouponModalCloseButton(): HTMLElement | undefined {
  const wraps = queryAllDeep<HTMLElement>(
    '.ant-modal-wrap, .ant-modal, .tbla-modal, [role="dialog"]',
  );

  for (const wrap of wraps) {
    if (!isVisibleEl(wrap)) continue;
    const hasCouponIframe = Array.from(wrap.querySelectorAll('iframe')).some((frame) => {
      const src = frame.getAttribute('src') || frame.src || '';
      return src.includes('app-live-platform-live-coupon') || src.includes('live-coupon');
    });
    const titleHint = compactVisibleText(wrap.textContent ?? '').includes('优惠券红包');
    if (!hasCouponIframe && !titleHint) continue;

    const close = pickAntModalClose(wrap);
    if (close) return close;
  }

  // 兜底：页面上可见的 ant-modal-close（投放确认后通常只剩这一层）
  const allCloses = queryAllDeep<HTMLElement>(
    'button.ant-modal-close[aria-label="Close"], button.ant-modal-close, .ant-modal-close',
  );
  for (const el of allCloses) {
    if (!isVisibleEl(el)) continue;
    const btn = el.closest('button') ?? el;
    if (btn instanceof HTMLElement && isVisibleEl(btn)) return btn;
  }
  return undefined;
}

function pickAntModalClose(scope: ParentNode): HTMLElement | undefined {
  const candidates = [
    ...scope.querySelectorAll<HTMLElement>(
      'button.ant-modal-close[aria-label="Close"], button.ant-modal-close, .ant-modal-close[aria-label="Close"], .ant-modal-close',
    ),
  ];
  for (const el of candidates) {
    if (!isVisibleEl(el)) continue;
    const btn = el.matches('button') ? el : el.closest('button');
    if (btn instanceof HTMLElement && isVisibleEl(btn)) return btn;
  }
  return undefined;
}

function hasBenefitSelectIframe(): boolean {
  return Array.from(document.querySelectorAll('iframe')).some((frame) => {
    const src = frame.getAttribute('src') || frame.src || '';
    return /awardBenefitSelect|smf\.taobao\.com/i.test(src);
  });
}

function describeBenefitIframes(): string {
  const srcs = Array.from(document.querySelectorAll('iframe'))
    .map((frame) => frame.getAttribute('src') || frame.src || '')
    .filter((src) => /awardBenefitSelect|smf\.taobao\.com/i.test(src))
    .slice(0, 3);
  return srcs.length ? `benefitIframe=[${srcs.join(' | ')}]` : '';
}

function hasAnyCouponRow(): boolean {
  const rows = queryAllDeep<HTMLElement>(
    'tr, .next-table-row, [data-next-table-row]',
  );
  for (const row of rows) {
    if (!isVisibleEl(row)) continue;
    const name = extractRowCouponName(row);
    if (name && name !== '名称/渠道' && name.length > 1) return true;
  }
  return false;
}

async function waitForCouponRow(
  want: string,
  timeoutMs: number = WaitTimeout.default,
): Promise<HTMLElement | undefined> {
  return waitUntil(() => findCouponRowByName(want), { timeoutMs, intervalMs: 300 });
}

function findCouponRowByName(want: string): HTMLElement | undefined {
  const rows = queryAllDeep<HTMLElement>(
    'tr, .next-table-row, [data-next-table-row], .next-table-body .next-table-row',
  );
  for (const row of rows) {
    if (!isVisibleEl(row)) continue;
    const name = extractRowCouponName(row);
    if (name && normalizeVisibleText(name) === want) {
      return row;
    }
  }

  const cells = queryAllDeep<HTMLElement>(
    '.next-table-cell, td, [class*="table-cell"]',
  );
  for (const cell of cells) {
    if (!isVisibleEl(cell)) continue;
    if (normalizeVisibleText(cell.textContent ?? '') !== want) continue;
    const row =
      cell.closest<HTMLElement>('tr, .next-table-row, [data-next-table-row]')
      ?? cell.parentElement;
    if (row instanceof HTMLElement) return row;
  }
  return undefined;
}

function extractRowCouponName(row: HTMLElement): string {
  const cells = row.querySelectorAll('.next-table-cell, td');
  if (cells.length >= 2) {
    const nameCell = cells[1];
    const text = normalizeVisibleText(nameCell.textContent ?? '');
    if (text && text !== '名称/渠道') return text;
  }
  const cloneText = normalizeVisibleText(row.textContent ?? '');
  return cloneText.split(/\s+/).find((part) => part && part !== '名称/渠道') ?? cloneText;
}

function findOkButton(): Element | undefined {
  const dialogs = queryAllDeep<HTMLElement>(
    '.next-dialog, .ant-modal, [role="dialog"], .tbla-modal',
  );
  const roots: ParentNode[] = dialogs.length > 0 ? dialogs : [document];
  for (const dialog of roots) {
    const ok =
      findClickableByText('OK', dialog)
      ?? findClickableByText('确定', dialog)
      ?? findElementByText('OK', { root: dialog, selector: 'button, [role="button"]', exact: true })
      ?? findElementByText('确定', { root: dialog, selector: 'button, [role="button"]', exact: true });
    if (!ok) continue;
    const btn = ok.closest('button, [role="button"], a') ?? ok;
    if (btn instanceof HTMLElement && isVisibleEl(btn)) return btn;
    if (btn) return btn;
  }
  return undefined;
}

async function ensureServiceAgreementChecked(): Promise<void> {
  const nodes = queryAllDeep<HTMLElement>('label, span, div, p');
  for (const node of nodes) {
    if (!isVisibleEl(node)) continue;
    const text = normalizeVisibleText(node.textContent ?? '');
    if (!text.includes('直播间红包技术服务协议') && !text.includes('我已阅读并确认')) {
      continue;
    }
    const field =
      node.closest('label, .next-checkbox-wrapper, .ant-checkbox-wrapper, div')
      ?? node;
    const input = field.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (input?.checked) return;
    const box =
      field.querySelector<HTMLElement>(
        '.next-checkbox, .ant-checkbox, input[type="checkbox"]',
      )
      ?? field;
    clickElement(box);
    await delay('short');
    return;
  }
}

function compactVisibleText(value: string): string {
  return normalizeVisibleText(value).replace(/\s+/g, '');
}

function findExactButton(text: string): Element | undefined {
  const want = compactVisibleText(text);
  const buttons = queryAllDeep<HTMLElement>(
    'button, [role="button"], a.next-btn, a.ant-btn',
  );
  for (const el of buttons) {
    if (!isVisibleEl(el)) continue;
    if (compactVisibleText(el.textContent ?? '') === want) return el;
  }
  const exact = findElementByText(normalizeVisibleText(text), {
    selector: 'button, [role="button"]',
    exact: true,
  });
  if (exact && isVisibleEl(exact as HTMLElement)) {
    return exact.closest('button, [role="button"], a') ?? exact;
  }
  return undefined;
}

/** 实页按钮文案为「投 放」（中间有空格），class 为 alp-dl-btn */
function findLaunchButton(): Element | undefined {
  const preferred = queryAllDeep<HTMLElement>(
    '.alp-dl-btn-group button.alp-dl-btn, button.alp-dl-btn, .alp-dl-btn-group button.ant-btn-primary',
  );
  for (const el of preferred) {
    if (!isVisibleEl(el)) continue;
    if (compactVisibleText(el.textContent ?? '') === '投放') return el;
  }
  return findExactButton('投放');
}

async function waitForLaunchButton(
  timeoutMs: number = WaitTimeout.default,
): Promise<Element | undefined> {
  return waitUntil(() => findLaunchButton(), { timeoutMs, intervalMs: 300 });
}

async function waitForExactButton(
  text: string,
  timeoutMs: number = WaitTimeout.default,
): Promise<Element | undefined> {
  return waitUntil(() => findExactButton(text), { timeoutMs, intervalMs: 300 });
}

async function waitForOkButton(
  timeoutMs: number = WaitTimeout.default,
): Promise<Element | undefined> {
  return waitUntil(() => findOkButton(), { timeoutMs, intervalMs: 300 });
}

async function selectUnlimitedByLabel(
  label: string,
  timeoutMs: number = WaitTimeout.default,
): Promise<boolean> {
  // 优先走 Fusion 适配器（含 alp-dl-label 旁侧 select，避免点到「领取条件」）
  if (await selectOptionNearLabel([label], '不限')) {
    return true;
  }
  const result = await waitUntil(() => trySelectUnlimited(label), { timeoutMs, intervalMs: 300 });
  return Boolean(result);
}

async function trySelectUnlimited(label: string): Promise<boolean> {
  const want = normalizeVisibleText(label);

  // C48：.alp-dl-label 右侧 sibling .next-select
  for (const labelEl of queryAllDeep<HTMLElement>('.alp-dl-label, label')) {
    if (!isVisibleEl(labelEl)) continue;
    const text = normalizeVisibleText(labelEl.textContent ?? '');
    if (text !== want && text !== `${want}：` && text !== `${want}:`) continue;
    const trigger = findSelectAmongNextSiblings(labelEl);
    if (!trigger) continue;
    fireSelectOpen(trigger);
    await delay('mid');
    const option =
      findVisibleOption('不限')
      ?? findClickableByText('不限');
    if (!option) {
      return normalizeVisibleText(trigger.textContent ?? '').includes('不限');
    }
    clickElement(option.closest('li, [role="option"], div, span') ?? option);
    await delay('mid');
    return true;
  }

  const labelEl =
    findElementByText(label, {
      selector: 'label, span, div, p',
      exact: false,
    });
  if (!labelEl) return false;

  const field =
    labelEl.closest('.next-form-item, .ant-form-item, .form-item')
    ?? labelEl.parentElement;
  if (!field) return false;

  // 勿用整卡 querySelector：同卡「领取条件」会先被命中
  const trigger =
    findSelectAmongNextSiblings(labelEl)
    ?? (field.querySelectorAll('.next-select').length === 1
      ? field.querySelector<HTMLElement>('.next-select, .ant-select, [role="combobox"]')
      : null)
    ?? findClickableByText('不限', field);

  if (trigger) {
    if (trigger instanceof HTMLElement && trigger.matches('.next-select, .ant-select')) {
      fireSelectOpen(trigger);
    } else {
      clickElement(trigger);
    }
    await delay('mid');
  }

  const option =
    findVisibleOption('不限')
    ?? findClickableByText('不限');
  if (!option) {
    const shown = normalizeVisibleText(
      (trigger ?? field).textContent ?? '',
    );
    return shown.includes('不限');
  }
  clickElement(option.closest('li, [role="option"], div, span') ?? option);
  await delay('mid');
  return true;
}

function findVisibleOption(text: string): Element | undefined {
  const nodes = [
    ...document.querySelectorAll<HTMLElement>(
      '.next-menu-item, .ant-select-item, [role="option"], .next-tree-node, li',
    ),
  ];
  for (const node of nodes) {
    if (!isVisibleEl(node)) continue;
    if (normalizeVisibleText(node.textContent ?? '') === text) return node;
  }
  return undefined;
}

function probeCouponNames(): string {
  const names: string[] = [];
  const rows = queryAllDeep<HTMLElement>(
    'tr, .next-table-row, [data-next-table-row]',
  );
  for (const row of rows.slice(0, 8)) {
    if (!isVisibleEl(row)) continue;
    const name = extractRowCouponName(row);
    if (name) names.push(name);
  }
  const iframeNote = hasBenefitSelectIframe()
    ? ` ${describeBenefitIframes()}（跨域不可读）`
    : '';
  return names.length
    ? `可见名称=[${names.join(' | ')}]。${iframeNote}`
    : iframeNote ? `${iframeNote}。` : '';
}

async function waitForClickableTexts(
  texts: string[],
  timeoutMs: number = WaitTimeout.default,
): Promise<Element | undefined> {
  return waitUntil(() => {
    for (const text of texts) {
      const el =
        findClickableByText(text)
        ?? findElementByText(text, {
          selector: 'button, [role="button"], span, div, a',
          exact: false,
        });
      if (el && normalizeVisibleText(el.textContent ?? '').includes(text.replace(/&/g, ''))) {
        return el;
      }
      if (el) return el;
    }
    return undefined;
  }, { timeoutMs, intervalMs: 300 });
}

function isVisibleEl(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
