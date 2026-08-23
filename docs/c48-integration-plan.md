# C48 优惠券发放功能接入实施计划

> 参考项目：`/Users/nmsn/Workspace/freelive-browser-extension`（淘宝直播 RPA 浏览器扩展）
> 目标：将扩展中 C48 优惠券发放能力移植到 browser-dock（Electron + CDP 架构），并建立可复用的 feature 接入框架。
> 决策记录：只做 c48 首批；DB 迁移 v4 加 feature_id/payload；不做 Excel 导入；Windows CI 尝试性修复不强求。

## 0. 关键简化

扩展需「列表页搜索→开详情 tab」两段编排（只能操作用户当前标签页）；browser-dock 自主控制 Chrome，已知 liveRoomId 时直接导航：

```
https://liveplatform.taobao.com/restful/index/live/control?liveId=<id>
```

c48 全流程收敛为：直连中控台详情页 → 弹窗分段执行。**不需要移植 c32 列表筛选段**。

## 1. c48 端到端流程（七段）

| # | 段 | 目标 frame | 动作 |
|---|----|-----------|------|
| 1 | 导航 | 主 target | 直连详情 URL，等 dashboard 就绪 |
| 2 | open | 主 target | 关阻塞弹窗 → 「互动工具」→「全部」→ 点「优惠券红包」入口 |
| 3 | prepare-benefit | coupon iframe（market.m…live-coupon） | 点「自有权益&授权的权益」→ 探测券行在同域还是跨域 smf iframe |
| 4 | select-coupon | 同域列表或 smf awardBenefitSelect iframe | 按 couponName 全等匹配行勾 radio；或 couponId 经网络捕获（userBenefitList.do 的 feature 串 templateId）匹配后按名称/顺序定位 |
| 5 | finish-options | coupon iframe | OK → 领取条件 cascader 路径（树校验）→ 投放渠道=不限 |
| 6 | push-and-close | coupon iframe | 服务协议勾选 → 投放（「投 放」alp-dl-btn）→ 二次确认「已检查完成，确认投放」 |
| 7 | close-dialog | 主 target | ant-modal-close 关壳弹窗 |

每段产出独立布尔标志；任一段失败即中止并保留已完成标志。

关键 URL / 选择器速查（源自参考项目实页验证）：

- 中控台详情：`liveplatform.taobao.com/restful/index/live/control?liveId=<id>`
- coupon 弹窗 iframe src 含 `app-live-platform-live-coupon` 或 `live-coupon`
- 跨域选券 iframe src 匹配 `/awardBenefitSelect|smf\.taobao\.com/i`
- 券列表接口 URL 子串：`userBenefitList.do`（templateId 藏于 `feature` 分号串 `templateId:<值>`）
- 壳关闭钮：`button.ant-modal-close[aria-label="Close"]`
- 投放按钮：`.alp-dl-btn`（文案「投 放」，匹配需压缩空白）

## 2. Phase A — CDP 基础设施

### A1 跨 frame 支持（src/main/chrome/cdp-client.ts）

- `send()` 增加 sessionId 参数（flat autoAttach 复用同一 WS）
- `Target.setAutoAttach({ flatten: true })`，监听 `Target.attachedToTarget` 维护 `{targetInfo.url → sessionId}` 表
- 新增 `session(urlSubstring)` 返回子会话句柄（evaluate 封装）

### A2 网络捕获服务（src/main/automation/network-capture.ts）

- 对相关会话 `Network.enable`，缓存 `{url, requestId}` 有界 30 条
- 查询时 `Network.getResponseBody` 取体解析
- 移植 extractCouponRows 解析逻辑（含 feature 分号串 templateId 提取）

### A3 页面脚本层（src/main/automation/page-script/*.js，Vite ?raw 注入）

| browser-dock 文件 | 移植来源 |
|---|---|
| page-script/deep-dom.js | shared/dom/deep-dom.ts |
| page-script/finders.js | shared/dom/finders.ts |
| page-script/dom-actions.js | shared/automation/dom-actions.ts |
| page-script/adapters/{select,cascader,checkbox,text-input}.js | shared/dom/adapters/* |
| page-script/wait-delay.js | wait.ts/delay.ts 页面侧轮询版 |

## 3. Phase B — 页面识别与修正

1. 移植 page-state.ts URL 判定 → `automation/taobao/page-state.ts`；live-detail-url.ts → 同目录
2. 修正既有错误：删除 live-control.ts 死代码 stub；inspection 探针 URL 改真实 dashboard 地址

## 4. Phase C — Feature 框架 + 数据模型

- 迁移 v4：tasks 表加 `feature_id TEXT`、`payload TEXT(JSON)`；实施时先查 type CHECK 约束
- shared/types.ts：`TaskType += 'feature'`，废弃 `'live-control'|'product'`（存量迁移为 'custom'）
- `automation/features/registry.ts`：registerFeature({ id, label, payloadSchema, run })
- task-executor 分流：type==='feature' → feature.run()（不经 vm），结果写 ExecutionLog.result；失败走诊断捕获；custom 路径不变

## 5. Phase D — c48 实现

新建 `automation/features/c48-coupon-send/`：

- types.ts：payload `{liveRoomId*, couponName?, couponId?, claimConditionPath?默认['不限']}`；claim-condition 树移植+路径校验；result 步进标志集
- flow.ts：七段编排，每段前检查 signal
- dom/*.js：open-dialog.js、fill-dialog.js、coupon-list.js（移植 open-coupon-dialog.ts / fill-coupon-dialog.ts / coupon-list-capture.ts）

重试语义：push-and-close 有副作用，c48 任务默认 maxAttempts=1 并在 UI 提示。

## 6. Phase E — UI

1. 任务对话框：类型「内置功能」→ 功能下拉（c48）→ schema 参数表单（场次ID/券名称/券ID 二选一/领取条件级联下拉）
2. 执行监控页：result 展开为步进标志徽章

## 7. 验证策略

- 自动化回归：本地 fixture 页模拟弹窗结构+Fusion 类名+iframe，验证 FrameRouter/DOM 工具/网络捕获管道（scripts/test-c48-fixture.mjs）
- 真实 E2E：手动登录后跑一次 c48 任务（人工核对步进标志）
- 每阶段自检门禁：`pnpm typecheck && pnpm build`；里程碑加跑 `pnpm test:executor`

## 8. Windows CI 尝试性修复（时间盒 30 分钟）

假设 pnpm 11 用 `allowBuilds`（布尔 map）替代旧字段：
1. 改 `allowBuilds: {better-sqlite3: true, esbuild: true, electron-winstaller: false}`
2. 本地 install 验证配置被接受 → 推送看 CI
3. 不通回滚，另行处理

---

## 进度记录

| 任务 | 状态 | 自检 | Commit |
|------|------|------|--------|
| 计划文档输出 | 🔄 进行中 | - | - |
| A1 跨 frame 支持 | ✅ 完成 | typecheck+build 通过 | - |
| A2 网络捕获 | ✅ 完成 | typecheck+build 通过 | - |
| A3 页面脚本层 | ⬜ 未开始 | - | - |
| B 页面识别与修正 | ✅ 完成 | typecheck+build 通过；live-control stub 已删除 | - |
| C Feature 框架+迁移 v4 | ✅ 完成 | typecheck+build+executor smoke 通过；迁移 v4 自动应用 | - |
| D c48 实现 | ⬜ 未开始 | - | - |
| D-verify fixture 回归 | ⬜ 未开始 | - | - |
| E UI | ⬜ 未开始 | - | - |
| F Windows CI 修复 | ⬜ 未开始 | - | - |
