import { findLiveListIdSearchInput, findSearchInputCandidate } from './search';
import {
  waitRequiredValue,
  waitUntil,
  WaitTimeout,
  type AutomationLogSink,
} from '../../../../shared/automation/wait';

/**
 * 直播计划页就绪判定（自 freelive-browser-extension dom/navigation.ts 移植）。
 *
 * browser-dock 嵌入式裁剪：扩展版含 SPA 侧栏展开兜底（453 行）——那是「后台把已打开的
 * 任意 tab 导航回列表页」场景用的。嵌入式由主进程对账号视图直接 loadURL 列表页地址，
 * 页面是新加载而非 SPA 切换，侧栏展开路径不可达，故仅保留就绪判定与短复检。
 */

export function isLiveListPage(): boolean {
  return window.location.pathname.includes('/live/list') && Boolean(findSearchInputCandidate());
}

/** URL 已是计划页，且右上角按 ID 搜索框已挂载（可填表）。 */
export function isLiveListPageReady(): boolean {
  return isLiveListPage() && Boolean(findLiveListIdSearchInput());
}

/**
 * 等到直播计划页就绪：URL 判定为计划页，且「按 ID 搜索」输入框已出现。
 * 仅等 URL 会在 SPA 切换中过早返回，导致后续填 ID 失败。
 */
export async function waitForLiveListPage(
  log: AutomationLogSink,
  timeoutMs: number = WaitTimeout.default,
): Promise<boolean> {
  const ready = await waitRequiredValue(
    () => isLiveListPageReady() || undefined,
    {
      label: '直播计划页搜索框',
      failureReason: '按 ID 搜索框未出现',
      timeoutMs,
      intervalMs: 250,
      log,
    },
  );
  return Boolean(ready);
}

/**
 * 直播计划页 DOM 稳定就绪：连续 stablePolls 次 poll 均为 isLiveListPageReady。
 * 避免 SPA 闪屏误判。
 */
export async function waitForLiveListPageStable(
  log: AutomationLogSink,
  timeoutMs: number = WaitTimeout.long,
  stablePolls: number = 3,
): Promise<boolean> {
  const need = Math.max(1, stablePolls);
  let consecutive = 0;
  const intervalMs = 250;

  log('info', `等待直播计划页搜索框稳定就绪（连续 ${need} 次）…`);
  const ready = await waitUntil(
    () => {
      if (isLiveListPageReady()) {
        consecutive += 1;
        if (consecutive >= need) {
          return true;
        }
        return undefined;
      }
      consecutive = 0;
      return undefined;
    },
    { timeoutMs, intervalMs, label: '直播计划页搜索框稳定' },
  );

  if (ready) {
    log('success', '直播计划页搜索框已稳定就绪');
    return true;
  }

  log('error', '直播计划页搜索框未稳定就绪（按 ID 搜索框未出现或闪烁）');
  return false;
}

/**
 * 业务侧短复检：主进程导航管道应已完成页面加载。
 * 仅覆盖注入前后的短暂竞态。
 */
export async function ensureLiveListPage(
  addLog: AutomationLogSink,
): Promise<boolean> {
  if (isLiveListPageReady()) {
    addLog('success', '直播计划页搜索框已就绪');
    return true;
  }

  addLog('info', '复检直播计划页「按 ID 搜索」框…');
  if (await waitForLiveListPageStable(addLog, 5_000, 2)) {
    return true;
  }

  addLog('error', '直播计划页搜索框未就绪，请刷新页面后重试');
  return false;
}
