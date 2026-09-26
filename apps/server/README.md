# apps/server — NestJS 12 场控服务端（里程碑②实施规格）

> 本文是里程碑②的实施规格：数据模型与状态机、设备注册认证、RPA 接口契约、桌面端对接时序。
> 决策记录见 `docs/adr/0003-server-scope-and-device-auth.md`；契约语义基线为
> freelive-browser-extension `docs/rpa-app-docs/12-场控自动化插件接口.md`（生产验证过）与
> `src/platforms/taobao/features/remote-task/contract.ts`。
> 接口层"实时文档"由 NestJS Swagger 提供（/docs），本文不重复端点字段清单。

## 1. 技术栈与形态

- NestJS **12**（^12，Node ≥20，仓库统一 Node 22）+ Prisma + PostgreSQL 16 + Swagger
- 端口 `3100`；`docker-compose.yml`：`app` + `postgres:16`；`.env`：`DATABASE_URL` / `JWT_SECRET` / `PORT`
- 模块划分：`auth`（设备注册 + 管理端 JWT）、`rooms`、`plans`（含 configs）、`rpa`（task 四接口 + 执行记录）、`admin`（简化管理 REST）
- 包名 `@browser-dock/server`；开工时同步抽取 `packages/shared`（`@browser-dock/shared`，types-only 契约 DTO/枚举，两端 `workspace:*`）

## 2. 数据模型（Prisma schema 草案）

枚举保持与扩展契约逐字对齐（桌面端零适配）；标注 ★ 的是阶段一真正用到的子集。

```prisma
// ── 设备（认证主体）────────────────────────────────────────────
model Device {
  id            String    @id                  // deviceId：客户端生成的 UUID，持久化
  tokenHash     String    @unique              // deviceToken 的 sha256（明文不落库）
  name          String?                        // 设备别名（注册时可选）
  lastSeenAt    DateTime?
  createdAt     DateTime  @default(now())
  records       ExecutionRecord[]
}

// ── 直播间维护（原平台「直播间维护」概念）────────────────────
model Room {
  id              Int      @id @default(autoincrement())
  taobaoAccountId String   @unique             // ★ 淘宝数字用户ID（userNumId），一对一绑定
  roomName        String
  note            String?
  enabled         Boolean  @default(true)      // 停用后 task/list 不返回其计划
  plans           Plan[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

// ── 直播计划（LIVE_PLAN）─────────────────────────────────────
// 状态机：PENDING_CREATE ──claim──▶ (执行) ──report──▶ CREATED（=终态，必须带 liveId）
//         PENDING_CREATE ──report FAILED──▶ CREATE_FAILED（终态）
//         任意 ──cancel──▶ CANCELLED（终态，仅限持有设备或未认领）
// ★ claim 行级 CAS：仅 PENDING_CREATE 可认领；同 deviceId 重领 = 自愈（不改状态）。
// ★ report 终态 CAS：终态（CREATED/CREATE_FAILED/CANCELLED）后的迟到写回直接忽略并记日志。
model Plan {
  id                  Int         @id @default(autoincrement())
  room                Room        @relation(fields: [roomId], references: [id])
  roomId              Int
  planCode            String?                          // 管理端可填的业务编号
  executionMode       String      @default("PLUGIN")   // ★ 只服务 PLUGIN；RPA 值保留枚举兼容
  liveDate            String                           // yyyy-MM-dd
  startTime           String?                         // HH:mm（展示用）
  endTime             String?
  liveId              String?                          // ★ 直播场次ID；report DONE 必回传
  liveTitle           String?
  planStatus          PlanStatus  @default(PENDING_CREATE)
  scheduledTriggerTime DateTime?                      // ★ 非空才出现在 task/list
  actualTriggerTime   DateTime?
  pluginVersion       String?
  claimDeviceId       String?                          // 认领排他 + 幽灵认领自愈依据
  claimTime           DateTime?
  executionResult     String?                          // ≤500 字
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt
  configs             PlanConfig[]
}

enum PlanStatus {
  PENDING_CREATE   // ★ 可认领
  CREATING
  CREATED          // ★ 终态（DONE；liveId 必填）
  CREATE_FAILED    // ★ 终态
  CANCELLING
  CANCELLED        // ★ 终态
}

// ── 任务配置（LIVE_PLAN_CONFIG，真正下发给桌面端执行的自动化）──
// 状态机：PENDING_PUSH ──claim──▶ EXECUTING（report）──▶ DONE（终态）
//         PENDING_PUSH ──claim──▶ EXECUTING ──report FAILED──▶
//           configType ∈ 自动重试集合 && retryCount < 3 ──▶ 重置 PENDING_PUSH、retryCount+1
//         否则 FAILED（终态，客户端不得重试）
// ★ 与 Plan 相同的 claim 行级 CAS / 终态 CAS / cancel 规则。
model PlanConfig {
  id                   Int          @id @default(autoincrement())
  plan                 Plan         @relation(fields: [planId], references: [id])
  planId               Int
  configType           ConfigType                        // ★ 阶段一仅 HOT_ITEM_TOP
  configData           Json                              // ★ HOT_ITEM_TOP：{ hotItemSlotIds: "id1\nid2\nid3" }
  configStatus         ConfigStatus @default(PENDING_PUSH)
  retryCount           Int          @default(0)          // ★ 服务端自动重试计数（上限 3）
  scheduledTriggerTime DateTime?                         // ★ 非空才可认领
  actualTriggerTime    DateTime?
  executionResult      String?                           // ≤500 字
  failReason           String?                           // ≤500 字
  returnTime           DateTime?                         // 终态回报时间
  claimDeviceId        String?
  claimTime            DateTime?
  createdAt            DateTime     @default(now())
  updatedAt            DateTime     @updatedAt
}

enum ConfigType {
  HOT_ITEM_TOP      // ★ 爆品置顶（阶段一）
  FAN_PACKET        // 粉丝红包（自动重试集合成员，功能未迁移）
  SECKILL
  SECKILL_PUSH
  FLASH_DISCOUNT
  COUPON
  COMMENT_LUCKY_DRAW
  SHARE_LUCKY_DRAW
  PACKET_RAIN
  FREE_LUCKY_DRAW
}

enum ConfigStatus {
  PENDING_PUSH     // ★ 可认领 / 自动重试的重置目标
  PUSH_FAILED
  IN_LINE
  WAIT_EXECUTE
  EXECUTING        // ★ 认领后执行中（report 中间态，仅当前持有设备可写）
  DONE             // ★ 终态
  FAILED           // ★ 终态（重试耗尽或不可重试类型）
  CANCELLING
  CANCELLED        // ★ 终态
  CLOSED
}

// ── 执行记录（失败截图 + 过程上报，对应看板）──────────────────
model ExecutionRecord {
  id             Int      @id @default(autoincrement())
  device         Device   @relation(fields: [deviceId], references: [id])
  deviceId       String
  taobaoAccountId String
  planId         Int?
  configId       Int?
  configType     String?
  status         String                        // DONE / FAILED / CANCELLED
  result         Json?                         // 结构化结果（steps 等）
  failReason     String?
  screenshotPath String?                       // 失败截图落盘路径（≤5MB）
  createdAt      DateTime @default(now())
}
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

1. docker-compose（app + postgres）+ Prisma schema + 首次迁移
2. `auth`：设备注册 + JWT guard（先于一切接口）
3. `admin`：rooms / plans / configs CRUD（有数据才能联调 RPA）
4. `rpa`：task 四接口 + execution-records（状态机与 CAS 是重点，照本文第 2/4 节实现）
5. Swagger 收尾 + curl 集成自测脚本（注册→录入→list→claim→report 全流程）
6. `packages/shared` 契约抽取（`@browser-dock/shared`：TaskType/状态枚举/请求响应 DTO）
7. CI 增加 server job（typecheck + build；`working-directory: apps/server`）
