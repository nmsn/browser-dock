/**
 * C32 页面侧 API 聚合（由 entry/main.ts 挂载到 window.__BDC32）。
 *
 * 主进程编排（features/c32-hot-product-pin/index.ts）经 PageAdapter.evaluate 逐个调用，
 * 每次调用返回 JSON 可序列化结果；执行日志经 drainLogs() 在每次调用后回收。
 * 取消：页面侧不感知 AbortSignal，主进程在每次 evaluate 之间检查并中止。
 */

import { ensureLiveListPage } from '../../shared/dom/navigation';
import {
  isDetailLiveReady,
  waitForDetailLiveStatus,
} from '../../shared/dom/detail-live-status';
import {
  clearProductIdSearch,
  fillProductIdSearch,
  pinHotProductById,
  waitPocketProductsUiReady,
} from './dom/pin-hot-product';
import { fillLiveListIdSearch, resetLiveListFilters } from './dom/live-list-filter';
import { openLiveDetailFromList } from './dom/open-live-detail';
import type { C32PinProductItem } from './types';
import type { AutomationLogSink } from '../../../../shared/automation/wait';

export type Json = Record<string, unknown>;

const logBuffer: string[] = []
const sink: AutomationLogSink = (level, message) => {
  logBuffer.push(`${level}:${message}`)
  if (logBuffer.length > 200) logBuffer.shift()
}

/** 回收本次调用期间产生的执行日志（主进程在每次 evaluate 后调用） */
export function drainLogs(): string[] {
  return logBuffer.splice(0, logBuffer.length)
}

/** 列表页就绪复检（主进程已 loadURL 列表页） */
export async function ensureListReady(): Promise<boolean> {
  return ensureLiveListPage(sink)
}

/** 填写列表页「按 ID 搜索」并等待防抖生效 */
export async function fillLiveListSearch(liveRoomId: string): Promise<boolean> {
  return fillLiveListIdSearch(liveRoomId, sink)
}

/** 列表行点击「直播详情」；详情地址由主进程 setWindowOpenHandler / did-navigate 捕获 */
export async function clickLiveDetail(liveRoomId: string): Promise<Json> {
  const result = await openLiveDetailFromList(liveRoomId, { log: sink })
  return { ...result }
}

/** 探测详情页头部开播状态（等待 document complete + 状态 tag） */
export async function probeDetailStatus(waitMs?: number): Promise<Json> {
  const reading = await waitForDetailLiveStatus(waitMs)
  return {
    known: reading.kind !== 'unknown',
    ready: isDetailLiveReady(reading.kind),
    kind: reading.kind,
    label: reading.label,
  }
}

/** 口袋商品区业务就绪门禁（口袋 Tab 或搜索框出现，25s） */
export async function waitPocketUiReady(): Promise<boolean> {
  return waitPocketProductsUiReady(sink)
}

/** 单商品置顶（口袋 Tab → 维度切换 → 按 ID 搜索 → 置顶点击 → 弹窗状态机） */
export async function pinProductById(productId: string): Promise<Json> {
  const result = await pinHotProductById(productId, { log: sink })
  return { ...result }
}

/** 全部成功后清空搜索，恢复完整商品列表 */
export async function clearSearch(): Promise<Json> {
  return clearProductIdSearch({ log: sink })
}

/** 失败场景回填首个失败商品 ID，保留错误现场供截图 */
export async function refillSearch(productId: string): Promise<boolean> {
  return fillProductIdSearch(productId, sink)
}

/** 任务收尾：回列表后恢复默认筛选（清空 ID、状态=全部） */
export async function resetListFilters(): Promise<Json> {
  return resetLiveListFilters(sink)
}

/** 页面世界自检（注入幂等探测用） */
export function probeAlive(): boolean {
  return true
}

export type { C32PinProductItem }
