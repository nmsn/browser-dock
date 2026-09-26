# apps/server — NestJS 12 场控服务端（里程碑②实施规格）

> 本文是里程碑②的实施规格：数据模型与状态机、设备注册认证、RPA 接口契约、桌面端对接时序。
> 决策记录见 `docs/adr/0003-server-scope-and-device-auth.md`；契约语义基线为
> freelive-browser-extension `docs/rpa-app-docs/12-场控自动化插件接口.md`（生产验证过）与
> `src/platforms/taobao/features/remote-task/contract.ts`。
> 接口层"实时文档"由 NestJS Swagger 提供（/docs），本文不重复端点字段清单。

## 1. 技术栈与形态

- NestJS **12**（^12，Node ≥20，仓库统一 Node 22）+ **Drizzle ORM** + PostgreSQL 16 + Swagger
  - 迁移用 drizzle-kit（`drizzle-kit generate` / `migrate`）；NestJS 侧以自定义 Provider（`DrizzleClient`）注入 db 实例（drizzle-orm/postgres-js）
- 端口 `3100`；`docker-compose.yml`：`app` + `postgres:16`；`.env`：`DATABASE_URL` / `JWT_SECRET` / `PORT`
- 模块划分：`auth`（设备注册 + 管理端 JWT）、`rooms`、`plans`（含 configs）、`rpa`（task 四接口 + 执行记录）、`admin`（简化管理 REST）
- 包名 `@browser-dock/server`；开工时同步抽取 `packages/shared`（`@browser-dock/shared`，types-only 契约 DTO/枚举，两端 `workspace:*`）

## 2. 数据模型（Drizzle schema 草案）

枚举保持与扩展契约逐字对齐（桌面端零适配）；标注 ★ 的是阶段一真正用到的子集。

```ts
// schema.ts（drizzle-orm/pg-core）
import { boolean, integer, jsonb, pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

// ── 枚举：与扩展 contract.ts 逐字对齐 ──────────────────────────
export const planStatusEnum = pgEnum('plan_status', [
  'PENDING_CREATE',   // ★ 可认领
  'CREATING',
  'CREATED',          // ★ 终态（= DONE；liveId 必填）
  'CREATE_FAILED',    // ★ 终态
  'CANCELLING',
  'CANCELLED',        // ★ 终态
])

export const configTypeEnum = pgEnum('config_type', [
  'HOT_ITEM_TOP',      // ★ 爆品置顶（阶段一）
  'FAN_PACKET',        // 粉丝红包（自动重试集合成员，功能未迁移）
  'SECKILL', 'SECKILL_PUSH', 'FLASH_DISCOUNT', 'COUPON',
  'COMMENT_LUCKY_DRAW', 'SHARE_LUCKY_DRAW', 'PACKET_RAIN', 'FREE_LUCKY_DRAW',
])

export const configStatusEnum = pgEnum('config_status', [
  'PENDING_PUSH',    // ★ 可认领 / 自动重试的重置目标
  'PUSH_FAILED',
  'IN_LINE',
  'WAIT_EXECUTE',
  'EXECUTING',       // ★ 认领后执行中（report 中间态，仅当前持有设备可写）
  'DONE',            // ★ 终态
  'FAILED',          // ★ 终态（重试耗尽或不可重试类型）
  'CANCELLING',
  'CANCELLED',       // ★ 终态
  'CLOSED',
])

// ── 设备（认证主体）────────────────────────────────────────────
export const devices = pgTable('devices', {
  id: text('id').primaryKey(),            // deviceId：客户端生成的 UUID，持久化
  tokenHash: text('token_hash').notNull().unique(), // deviceToken 的 sha256（明文不落库）
  name: text('name'),                     // 设备别名（注册时可选）
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── 直播间维护（原平台「直播间维护」概念）────────────────────
export const rooms = pgTable('rooms', {
  id: serial('id').primaryKey(),
  taobaoAccountId: text('taobao_account_id').notNull().unique(), // ★ 淘宝数字用户ID，一对一绑定
  roomName: text('room_name').notNull(),
  note: text('note'),
  enabled: boolean('enabled').notNull().default(true), // 停用后 task/list 不返回其计划
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── 直播计划（LIVE_PLAN）─────────────────────────────────────
// 状态机：PENDING_CREATE ──claim──▶ (执行) ──report──▶ CREATED（=终态，必须带 liveId）
//         PENDING_CREATE ──report FAILED──▶ CREATE_FAILED（终态）
//         任意 ──cancel──▶ CANCELLED（终态，仅限持有设备或未认领）
// ★ claim 行级 CAS：仅 PENDING_CREATE 可认领；同 deviceId 重领 = 自愈（不改状态）。
// ★ report 终态 CAS：终态后的迟到写回直接忽略并记日志。
export const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
  roomId: integer('room_id').notNull().references(() => rooms.id),
  planCode: text('plan_code'),                          // 管理端可填的业务编号
  executionMode: text('execution_mode').notNull().default('PLUGIN'), // ★ 只服务 PLUGIN
  liveDate: text('live_date').notNull(),                // yyyy-MM-dd
  startTime: text('start_time'),                        // HH:mm（展示用）
  endTime: text('end_time'),
  liveId: text('live_id'),                              // ★ 直播场次ID；report DONE 必回传
  liveTitle: text('live_title'),
  planStatus: planStatusEnum('plan_status').notNull().default('PENDING_CREATE'),
  scheduledTriggerTime: timestamp('scheduled_trigger_time', { withTimezone: true }), // ★ 非空才出现在 task/list
  actualTriggerTime: timestamp('actual_trigger_time', { withTimezone: true }),
  pluginVersion: text('plugin_version'),
  claimDeviceId: text('claim_device_id'),               // 认领排他 + 幽灵认领自愈依据
  claimTime: timestamp('claim_time', { withTimezone: true }),
  executionResult: text('execution_result'),            // ≤500 字
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── 任务配置（LIVE_PLAN_CONFIG，真正下发给桌面端执行的自动化）──
// 状态机：PENDING_PUSH ──claim──▶ EXECUTING（report）──▶ DONE（终态）
//         PENDING_PUSH ──claim──▶ EXECUTING ──report FAILED──▶
//           configType ∈ 自动重试集合 && retryCount < 3 ──▶ 重置 PENDING_PUSH、retryCount+1
//         否则 FAILED（终态，客户端不得重试）
// ★ 与 plans 相同的 claim 行级 CAS / 终态 CAS / cancel 规则。
export const planConfigs = pgTable('plan_configs', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id').notNull().references(() => plans.id),
  configType: configTypeEnum('config_type').notNull(),  // ★ 阶段一仅 HOT_ITEM_TOP
  configData: jsonb('config_data').notNull(),           // ★ HOT_ITEM_TOP：{ hotItemSlotIds: "id1\nid2\nid3" }
  configStatus: configStatusEnum('config_status').notNull().default('PENDING_PUSH'),
  retryCount: integer('retry_count').notNull().default(0), // ★ 服务端自动重试计数（上限 3）
  scheduledTriggerTime: timestamp('scheduled_trigger_time', { withTimezone: true }), // ★ 非空才可认领
  actualTriggerTime: timestamp('actual_trigger_time', { withTimezone: true }),
  executionResult: text('execution_result'),            // ≤500 字
  failReason: text('fail_reason'),                      // ≤500 字
  returnTime: timestamp('return_time', { withTimezone: true }), // 终态回报时间
  claimDeviceId: text('claim_device_id'),
  claimTime: timestamp('claim_time', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── 执行记录（失败截图 + 过程上报，对应看板）──────────────────
export const executionRecords = pgTable('execution_records', {
  id: serial('id').primaryKey(),
  deviceId: text('device_id').notNull().references(() => devices.id),
  taobaoAccountId: text('taobao_account_id').notNull(),
  planId: integer('plan_id'),
  configId: integer('config_id'),
  configType: text('config_type'),
  status: text('status').notNull(),                     // DONE / FAILED / CANCELLED
  result: jsonb('result'),                              // 结构化结果（steps 等）
  failReason: text('fail_reason'),
  screenshotPath: text('screenshot_path'),              // 失败截图落盘路径（≤5MB）
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

**契约对齐说明**：扩展的 `isConfigClaimable` 判 `pluginStatusCode === 'WAIT_EXECUTE' || configStatus === 'PENDING_PUSH'`——本服务端只维护单一 `configStatus`，`task/list` 响应省略 `pluginStatusCode`，客户端走 PENDING_PUSH 回退分支即可，零适配。

## 3. 认证

### 设备注册（RPA 接口的认证主体）

```
POST /rpa/devices/register      { deviceId, name? }  →  { deviceToken }
```

- 首次注册：生成 32B 随机 token（只返回一次，服务端存 sha256）
- 同 deviceId 重复注册：轮换 token（旧 token 立即失效）
- 后续所有 `/rpa/*` 请求：`Authorization: Bearer <deviceToken>`；服务端从 token 解出 deviceId
- 请求体里的 `deviceId` 与 token 不一致 → 403（契约字段保留，但不作为授权依据）
- token 服务端重置后客户端收到 401 → 自动重新注册（桌面端 poller 内置该恢复）

### 管理端（简化 REST，阶段一无 Web 页面）

```
POST /admin/auth/login   { username, password }  →  { accessToken }   // JWT，8h
```

`/admin/*` 全部挂 JWT guard；账号来自 `.env`（`ADMIN_USER` / `ADMIN_PASSWORD`），阶段一单账号。

## 4. RPA 接口契约（语义要点）

四个接口 + 执行记录，路径与请求/响应字段逐字对齐扩展契约（Swagger 为准），语义要点：

| 接口 | 语义要点 |
|---|---|
| `POST /rpa/task/list` | 按 `taobaoAccount` 查绑定房间（未绑定报「该淘宝账号未绑定直播间」）；返回当天 + 跨天未关闭计划；仅 `executionMode=PLUGIN` 且 `scheduledTriggerTime` 非空；响应含 `claimDevice`/`claimTime`（客户端幽灵认领自愈用） |
| `POST /rpa/task/claim` | 批量（≤30）行级 CAS 认领：计划 `PENDING_CREATE` / 配置 `PENDING_PUSH` 可认领；同 deviceId 重领返回 claimed（自愈）；他设备已认领返回 rejected「已被其他设备认领」；LIVE_PLAN 认领要求房间已绑定 |
| `POST /rpa/task/report` | `EXECUTING` 仅当前持有设备可写；终态 CAS：已终态的迟到写回忽略 + 记日志；LIVE_PLAN DONE 必带 `liveId` 否则拒收；`FAILED` 且 configType ∈ 自动重试集合（阶段一 = HOT_ITEM_TOP）且 `retryCount < 3` → 重置 `PENDING_PUSH`、`retryCount+1`；`failReason`/`executionResult` 截断 500 字 |
| `POST /rpa/task/cancel` | 幂等；仅限该设备持有/执行中的任务；把状态置 CANCELLED（终态） |
| `POST /rpa/execution-records` | multipart：`record`（JSON 字符串）+ 可选 `failureScreenshot`（≤5MB，超限丢弃图片保留记录）；返回 `{ id }` |

**取消感知**：无服务端推送。取消 = 管理端把状态置 CANCELLED（从 list 消失）；客户端轮询发现；`task/cancel` 仅用于客户端侧显式用户取消的回执。

## 5. 桌面端对接时序（里程碑③实现，此处为约定基线）

```
轮询 task/list（默认 60s，可配）
  └─ 事件驱动同步：手动刷新 / 任意任务终态回报后 / 设备注册成功后
认领（claim，批量 ≤30）
  ├─ 排期已过期 > 5min → 不认领，直接 report FAILED「排期已过期 N 分钟」
  └─ 认领成功 → 本地建一次性定时（scheduledTriggerTime，应用重启后 re-arm）
触发执行
  ├─ queued→running 时上报 EXECUTING（仅 config 任务）
  ├─ 执行（嵌入式宿主跑对应 feature，如 C32）
  └─ 终态上报 DONE（LIVE_PLAN 带 liveId）/ FAILED（failReason）
     └─ 上报失败退避重试 [60s, 300s, 900s]；应用重启后补偿重发未确认终态
        （服务端终态 CAS 保证幂等，重发无害）
幽灵认领自愈：list 中 claimDevice=自己 且 claimTime 超 10min 仍可认领态 → 重新认领
失败截图：终态后上传 execution-records（报告与写回解耦，互相不阻塞）
```

## 6. 管理端 REST（辅助执行，阶段一范围）

```
POST   /admin/auth/login
GET    /admin/rooms                  POST /admin/rooms          PUT/DELETE /admin/rooms/:id
GET    /admin/plans?date=            POST /admin/plans          PUT/DELETE /admin/plans/:id
POST   /admin/plans/:id/configs      PUT/DELETE /admin/configs/:id
POST   /admin/configs/:id/trigger    # 立即执行：scheduledTriggerTime = now
POST   /admin/configs/:id/retry      # 手动重置 PENDING_PUSH（retryCount 清零）
GET    /admin/records?deviceId=&configId=
```

HOT_ITEM_TOP 的 `configData.hotItemSlotIds` 录入校验：换行分隔、1–3 个、纯数字——服务端创建/更新时校验（与客户端 `MappingError` 同规则）。

## 7. 实施顺序

1. docker-compose（app + postgres）+ Drizzle schema + `drizzle-kit generate` 首次迁移
2. `auth`：设备注册 + JWT guard（先于一切接口）
3. `admin`：rooms / plans / configs CRUD（有数据才能联调 RPA）
4. `rpa`：task 四接口 + execution-records（状态机与 CAS 是重点，照本文第 2/4 节实现）
5. Swagger 收尾 + curl 集成自测脚本（注册→录入→list→claim→report 全流程）
6. `packages/shared` 契约抽取（`@browser-dock/shared`：TaskType/状态枚举/请求响应 DTO）
7. CI 增加 server job（typecheck + build；`working-directory: apps/server`）
