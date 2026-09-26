/**
 * @browser-dock/shared — RPA 契约类型
 *
 * 与服务端（apps/server）接口及 freelive-browser-extension
 * remote-task/contract.ts 逐字对齐；仅类型，零运行时。
 * 消费方以 `import type` 引入（编译期擦除，桌面端主进程/预加载/渲染层
 * 与 server 均无需额外构建配置）。
 */

// ── 任务类型 ────────────────────────────────────────────────

export type RpaTaskType = 'LIVE_PLAN' | 'LIVE_PLAN_CONFIG'

// ── 计划 / 配置状态 ─────────────────────────────────────────

export type RemotePlanStatus =
  | 'PENDING_CREATE'
  | 'CREATING'
  | 'CREATED'
  | 'CREATE_FAILED'
  | 'CANCELLING'
  | 'CANCELLED'

/** 含上游侧状态（PUSHED/WAIT_EXECUTE/CLOSED 等不对应插件动作） */
export type RemoteConfigStatus =
  | 'PENDING_PUSH'
  | 'PUSH_FAILED'
  | 'IN_LINE'
  | 'WAIT_EXECUTE'
  | 'EXECUTING'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'CLOSED'

export type RemoteConfigType =
  | 'HOT_ITEM_TOP'
  | 'FAN_PACKET'
  | 'SECKILL'
  | 'SECKILL_PUSH'
  | 'FLASH_DISCOUNT'
  | 'COUPON'
  | 'COMMENT_LUCKY_DRAW'
  | 'SHARE_LUCKY_DRAW'
  | 'PACKET_RAIN'
  | 'FREE_LUCKY_DRAW'

/** 服务端自动重试集合（FAILED → 重置 PENDING_PUSH，retryCount < 3） */
export const AUTO_RETRY_CONFIG_TYPES: readonly RemoteConfigType[] = ['HOT_ITEM_TOP']

// ── task/list ───────────────────────────────────────────────

export interface TaskListRequest {
  taobaoAccount: string
  /** 场次日期 yyyy-MM-dd，为空取北京时区当天 */
  liveDate?: string
  planStatuses?: RemotePlanStatus[]
}

/** 封面/奖品图：fileId + 预签名下载地址（预留） */
export interface RemoteFileRef {
  fileId: number
  url: string
}

export interface RemoteConfigItem {
  id: number
  planId: number
  configType: RemoteConfigType
  configTypeDesc?: string | null
  configData: Record<string, unknown> | null
  configStatus: RemoteConfigStatus
  /** 契约对齐说明：本服务端不返回 pluginStatusCode，可认领判定走 configStatus */
  pluginStatusCode?: string | null
  pluginStatus?: string | null
  needId?: number | null
  retryCount?: number | null
  scheduledTriggerTime?: string | null
  actualTriggerTime?: string | null
  executionResult?: string | null
  returnTime?: string | null
  claimDevice?: string | null
  claimTime?: string | null
  createTime?: string | null
}

export interface RemotePlan {
  id: number
  planCode?: string | null
  roomId?: number | null
  roomName?: string | null
  executionMode?: 'RPA' | 'PLUGIN' | null
  liveDate?: string | null
  startTime?: string | null
  endTime?: string | null
  liveId?: string | null
  liveTitle?: string | null
  planStatus?: RemotePlanStatus
  scheduledTriggerTime?: string | null
  actualTriggerTime?: string | null
  claimDevice?: string | null
  claimTime?: string | null
  executionResult?: string | null
  createTime?: string | null
  configList?: RemoteConfigItem[] | null
  configTotal?: number | null
  configDone?: number | null
}

export interface RemoteRoom {
  roomId: number | null
  roomName: string | null
  liveDate: string | null
  updateTime: string | null
  plans: RemotePlan[]
}

/** 可认领判定（pluginStatusCode 缺省时按原始状态回退，桌面端契约逻辑） */
export function isPlanClaimable(plan: RemotePlan): boolean {
  return plan.pluginStatusCode === 'WAIT_EXECUTE' || plan.planStatus === 'PENDING_CREATE'
}

export function isConfigClaimable(config: RemoteConfigItem): boolean {
  return config.pluginStatusCode === 'WAIT_EXECUTE' || config.configStatus === 'PENDING_PUSH'
}

// ── task/claim ──────────────────────────────────────────────

export interface ClaimTaskRef {
  taskType: RpaTaskType
  taskId: number
}

export interface TaskClaimRequest {
  taobaoAccount: string
  deviceId: string
  pluginVersion: string
  /** 批量 ≤30 */
  tasks: ClaimTaskRef[]
}

export interface TaskClaimResult {
  claimed: ClaimTaskRef[]
  rejected: Array<ClaimTaskRef & { reason?: string | null }>
}

// ── task/report ─────────────────────────────────────────────

export type TaskReportStatus = 'EXECUTING' | 'DONE' | 'FAILED' | 'CANCELLED'

export interface TaskReportRequest {
  taobaoAccount: string
  taskType: RpaTaskType
  taskId: number
  status: TaskReportStatus
  actualTriggerTime?: string
  finishTime?: string
  failReason?: string
  executionResult?: string
  /** LIVE_PLAN 报 DONE 必带 */
  liveId?: string
  pluginVersion?: string
  deviceId?: string
}

// ── task/cancel ─────────────────────────────────────────────

export interface TaskCancelRequest {
  taobaoAccount: string
  taskType: RpaTaskType
  taskId: number
  deviceId?: string
}

// ── 设备注册 ────────────────────────────────────────────────

export interface DeviceRegisterRequest {
  deviceId: string
  name?: string
}

export interface DeviceRegisterResult {
  deviceToken: string
}
