import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp
} from 'drizzle-orm/pg-core'

/**
 * Browser Dock 场控服务端数据模型
 * @see apps/server/README.md 第 2 节（状态机与 ★ 阶段一子集标注）
 * 契约基线：freelive-browser-extension remote-task/contract.ts（枚举逐字对齐，桌面端零适配）
 */

// ── 枚举：与扩展 contract.ts 逐字对齐 ──────────────────────────

export const planStatusEnum = pgEnum('plan_status', [
  'PENDING_CREATE', // ★ 可认领
  'CREATING',
  'CREATED', // ★ 终态（= DONE；liveId 必填）
  'CREATE_FAILED', // ★ 终态
  'CANCELLING',
  'CANCELLED' // ★ 终态
])

export const configTypeEnum = pgEnum('config_type', [
  'HOT_ITEM_TOP', // ★ 爆品置顶（阶段一）
  'FAN_PACKET', // 粉丝红包（自动重试集合成员，功能未迁移）
  'SECKILL',
  'SECKILL_PUSH',
  'FLASH_DISCOUNT',
  'COUPON',
  'COMMENT_LUCKY_DRAW',
  'SHARE_LUCKY_DRAW',
  'PACKET_RAIN',
  'FREE_LUCKY_DRAW'
])

export const configStatusEnum = pgEnum('config_status', [
  'PENDING_PUSH', // ★ 可认领 / 自动重试的重置目标
  'PUSH_FAILED',
  'IN_LINE',
  'WAIT_EXECUTE',
  'EXECUTING', // ★ 认领后执行中（report 中间态，仅当前持有设备可写）
  'DONE', // ★ 终态
  'FAILED', // ★ 终态（重试耗尽或不可重试类型）
  'CANCELLING',
  'CANCELLED', // ★ 终态
  'CLOSED'
])

// ── 设备（认证主体）────────────────────────────────────────────

export const devices = pgTable('devices', {
  id: text('id').primaryKey(), // deviceId：客户端生成的 UUID，持久化
  tokenHash: text('token_hash').notNull().unique(), // deviceToken 的 sha256（明文不落库）
  name: text('name'), // 设备别名（注册时可选）
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

// ── 直播间维护（原平台「直播间维护」概念）────────────────────

export const rooms = pgTable('rooms', {
  id: serial('id').primaryKey(),
  taobaoAccountId: text('taobao_account_id').notNull().unique(), // ★ 淘宝数字用户ID，一对一绑定
  roomName: text('room_name').notNull(),
  note: text('note'),
  enabled: boolean('enabled').notNull().default(true), // 停用后 task/list 不返回其计划
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

// ── 直播计划（LIVE_PLAN）─────────────────────────────────────
// 状态机：PENDING_CREATE ──claim──▶ (执行) ──report──▶ CREATED（=终态，必须带 liveId）
//         PENDING_CREATE ──report FAILED──▶ CREATE_FAILED（终态）
//         任意 ──cancel──▶ CANCELLED（终态，仅限持有设备或未认领）
// ★ claim 行级 CAS：仅 PENDING_CREATE 可认领；同 deviceId 重领 = 自愈（不改状态）。
// ★ report 终态 CAS：终态后的迟到写回直接忽略并记日志。

export const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
  roomId: integer('room_id')
    .notNull()
    .references(() => rooms.id),
  planCode: text('plan_code'), // 管理端可填的业务编号
  executionMode: text('execution_mode').notNull().default('PLUGIN'), // ★ 只服务 PLUGIN
  liveDate: text('live_date').notNull(), // yyyy-MM-dd
  startTime: text('start_time'), // HH:mm（展示用）
  endTime: text('end_time'),
  liveId: text('live_id'), // ★ 直播场次ID；report DONE 必回传
  liveTitle: text('live_title'),
  planStatus: planStatusEnum('plan_status').notNull().default('PENDING_CREATE'),
  scheduledTriggerTime: timestamp('scheduled_trigger_time', { withTimezone: true }), // ★ 非空才出现在 task/list
  actualTriggerTime: timestamp('actual_trigger_time', { withTimezone: true }),
  pluginVersion: text('plugin_version'),
  claimDeviceId: text('claim_device_id'), // 认领排他 + 幽灵认领自愈依据
  claimTime: timestamp('claim_time', { withTimezone: true }),
  executionResult: text('execution_result'), // ≤500 字
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

// ── 任务配置（LIVE_PLAN_CONFIG，真正下发给桌面端执行的自动化）──
// 状态机：PENDING_PUSH ──claim──▶ EXECUTING（report）──▶ DONE（终态）
//         PENDING_PUSH ──claim──▶ EXECUTING ──report FAILED──▶
//           configType ∈ 自动重试集合 && retryCount < 3 ──▶ 重置 PENDING_PUSH、retryCount+1
//         否则 FAILED（终态，客户端不得重试）
// ★ 与 plans 相同的 claim 行级 CAS / 终态 CAS / cancel 规则。

export const planConfigs = pgTable('plan_configs', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'cascade' }), // 管理端删计划级联删配置
  configType: configTypeEnum('config_type').notNull(), // ★ 阶段一仅 HOT_ITEM_TOP
  configData: jsonb('config_data').notNull(), // ★ HOT_ITEM_TOP：{ hotItemSlotIds: "id1\nid2\nid3" }
  configStatus: configStatusEnum('config_status').notNull().default('PENDING_PUSH'),
  retryCount: integer('retry_count').notNull().default(0), // ★ 服务端自动重试计数（上限 3）
  scheduledTriggerTime: timestamp('scheduled_trigger_time', { withTimezone: true }), // ★ 非空才可认领
  actualTriggerTime: timestamp('actual_trigger_time', { withTimezone: true }),
  executionResult: text('execution_result'), // ≤500 字
  failReason: text('fail_reason'), // ≤500 字
  returnTime: timestamp('return_time', { withTimezone: true }), // 终态回报时间
  claimDeviceId: text('claim_device_id'),
  claimTime: timestamp('claim_time', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

// ── 执行记录（失败截图 + 过程上报，对应看板）──────────────────

export const executionRecords = pgTable('execution_records', {
  id: serial('id').primaryKey(),
  deviceId: text('device_id')
    .notNull()
    .references(() => devices.id),
  taobaoAccountId: text('taobao_account_id').notNull(),
  planId: integer('plan_id'),
  configId: integer('config_id'),
  configType: text('config_type'),
  status: text('status').notNull(), // DONE / FAILED / CANCELLED
  result: jsonb('result'), // 结构化结果（steps 等）
  failReason: text('fail_reason'),
  screenshotPath: text('screenshot_path'), // 失败截图落盘路径（≤5MB）
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

// 推导类型（service/controller 复用）
export type Device = typeof devices.$inferSelect
export type Room = typeof rooms.$inferSelect
export type Plan = typeof plans.$inferSelect
export type PlanConfig = typeof planConfigs.$inferSelect
export type ExecutionRecord = typeof executionRecords.$inferSelect
