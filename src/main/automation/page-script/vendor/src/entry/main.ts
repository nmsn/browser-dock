/**
 * 页面脚本 bundle 入口
 * @see docs/c48-integration-plan.md A3
 *
 * 由 scripts/build-page-scripts.mjs 用 esbuild 打包为 IIFE，
 * 产物经 Runtime.evaluate 注入页面世界（幂等），暴露 window.__BD / window.__BDC48。
 */

import {
  collectDomRoots,
  describeDomRoots,
  queryAllDeep,
} from '../platforms/taobao/shared/dom/deep-dom';
import {
  findClickableByText,
} from '../platforms/taobao/shared/dom/finders';
import {
  findElementByText,
  getElementVisibleText,
  normalizeVisibleText,
} from '../shared/automation/dom-actions';
import { WaitTimeout } from '../shared/automation/wait';
import {
  openCouponDialog,
} from '../platforms/taobao/features/c48-coupon-send/dom/open-coupon-dialog';
import {
  closeCouponShellDialog,
  confirmBenefitOkAndUnlimited,
  prepareOwnBenefit,
  pushCouponAndCloseDialog,
  selectCouponById,
  selectCouponByName,
  type CapturedCouponRow,
} from '../platforms/taobao/features/c48-coupon-send/dom/fill-coupon-dialog';

interface BdLib {
  version: number
  collectDomRoots: typeof collectDomRoots
  describeDomRoots: typeof describeDomRoots
  queryAllDeep: typeof queryAllDeep
  findClickableByText: typeof findClickableByText
  findElementByText: typeof findElementByText
  getElementVisibleText: typeof getElementVisibleText
  normalizeVisibleText: typeof normalizeVisibleText
  /** 页面 body 可见文本是否同时包含全部片段 */
  bodyTextIncludes: (...fragments: string[]) => boolean
}

declare global {
  interface Window {
    __BD?: BdLib
    __BDC48?: {
      openCouponDialog: typeof openCouponDialog
      prepareOwnBenefit: typeof prepareOwnBenefit
      selectCouponByName: typeof selectCouponByName
      selectCouponById: (couponId: string, rows: CapturedCouponRow[]) => ReturnType<typeof selectCouponById>
      confirmBenefitOkAndUnlimited: typeof confirmBenefitOkAndUnlimited
      pushCouponAndCloseDialog: typeof pushCouponAndCloseDialog
      closeCouponShellDialog: typeof closeCouponShellDialog
      probeCouponRowsText: () => string[]
    }
  }
}

function bodyTextIncludes(...fragments: string[]): boolean {
  const body = (document.body?.innerText ?? '').slice(0, 8000)
  return fragments.every((f) => body.includes(f))
}

/** 抽取表格行首列/次列文本（诊断用） */
function probeCouponRowsText(): string[] {
  const names: string[] = []
  for (const row of queryAllDeep<HTMLElement>('tr, .next-table-row, [data-next-table-row]').slice(0, 10)) {
    if (!row.getBoundingClientRect || row.getBoundingClientRect().width === 0) continue
    const cells = row.querySelectorAll('.next-table-cell, td')
    const text = cells.length >= 2
      ? (cells[1]?.textContent ?? '').trim()
      : (row.textContent ?? '').trim().split(/\s+/)[0] ?? ''
    const normalized = normalizeVisibleText(text)
    if (normalized && normalized !== '名称/渠道') names.push(normalized)
  }
  return names
}

window.__BD = {
  version: 1,
  collectDomRoots,
  describeDomRoots,
  queryAllDeep,
  findClickableByText,
  findElementByText,
  getElementVisibleText,
  normalizeVisibleText,
  bodyTextIncludes
}

window.__BDC48 = {
  openCouponDialog,
  prepareOwnBenefit,
  selectCouponByName,
  selectCouponById,
  confirmBenefitOkAndUnlimited,
  pushCouponAndCloseDialog,
  closeCouponShellDialog,
  probeCouponRowsText
}

export { WaitTimeout }
