# Browser Dock 术语表（Glossary）

> 本表统一 monorepo 内的领域词汇，来源：freelive-browser-extension 迁移 + browser-dock 现有实现。
> 变更术语含义时请先更新本表。

## 业务术语

| 术语 | 英文/代码标识 | 含义 |
|---|---|---|
| 爆品置顶 | C32 / `HOT_ITEM_TOP` | 核心自动化功能：在淘宝直播中控台（liveplatform.taobao.com）直播详情页的「口袋商品」中，把指定商品设为爆品（直播间内置顶展示）。单次最多 3 个商品。源自 freelive-browser-extension 的 c32-hot-product-pin。 |
| 口袋商品 | pocket products | 直播详情页的商品 Tab（「口袋商品」/「全部商品」），爆品置顶的操作面板。 |
| 直播场次 ID | liveRoomId / liveId | 一场淘宝直播的唯一标识。C32 的输入；列表页按它搜索定位直播详情页。 |
| 爆品位 ID | hotItemSlotIds | 远端任务配置中携带的商品 ID 列表（换行分隔，≤3，超出报错）。 |
| 直播间维护 | room binding | 原平台的「淘宝账号ID ↔ 直播间」绑定关系；NestJS server 简化管理端保留此概念。 |
| 淘宝账号 ID | userNumId / taobaoAccount | 淘宝数字用户 ID，通过页面自身 `mtop.user.getusersimple` 响应捕获；服务端按它匹配房间与任务。 |
| 场控 | live control | liveplatform.taobao.com 的直播控制台（列表页 + 详情/中控页）。 |
| 计划 | LIVE_PLAN / RemotePlan | 平台任务模型的上层：一场直播计划（含 liveId、触发时间 scheduledTriggerTime）。 |
| 任务配置 | LIVE_PLAN_CONFIG / RemoteConfigItem | 平台任务模型下层：挂在计划下的具体自动化配置（configType=HOT_ITEM_TOP 等 + configData）。 |
| 认领 | claim | 客户端拉取任务后通过 `task/claim` 以 deviceId 独占任务（服务端行级 CAS，可按同 deviceId 自愈重领）。 |
| 回报/写回 | report | 终态上报（EXECUTING/DONE/FAILED/CANCELLED），服务端终态 CAS：迟到写回忽略并记录。 |
| 执行记录 | execution record | 含失败截图（multipart，≤5MB）的执行过程上报；NestJS 保留此接口。 |
| 运行模式 | run-mode (`local` / `remote`) | 本地模式（用户手动/定时触发）与远端模式（轮询 server 认领任务）双轨。 |
| 远端自动重试 | server-side retry | 服务端仅对 HOT_ITEM_TOP 等配置自动重置到待执行（≤3 次）；客户端对置顶本身不重试（幂等：已置顶即跳过）。 |

## 技术术语

| 术语 | 含义 |
|---|---|
| 节流/冷冻 | Chromium 对后台/被遮挡页面的限制：定时器降频、rAF 暂停、renderer 降级。Electron 解法：`webPreferences.backgroundThrottling: false` + app 级 switch（`disable-background-timer-throttling` 等）+ 执行期 `powerSaveBlocker`。 |
| Session Partition | Electron 会话分区（`persist:account-<id>`）：每账号独立 cookie 存储，实现单进程多淘宝账号登录态。 |
| 账号视图 | 账号窗口（`BaseWindow` + `WebContentsView`）：每账号一个内嵌视图，替代原外部 Chrome 标签页；执行时默认隐藏。 |
| page-script | browser-dock 的页面自动化脚本形态：esbuild 打包的 IIFE bundle（`src/main/automation/page-script/dist/page-bundle.js`），由主进程注入目标页面执行（嵌入式下为 `did-navigate` 后 `executeJavaScript`）。 |
| DOM 适配器 | browser-dock `page-script/vendor` 下的淘宝中后台组件适配层（tbla/tbd/ant/next-fusion 的 select、date-picker、checkbox、cascader 等），C32 复用。 |
| 设备注册 | desktop 首次启动以 deviceId 向 server 注册换取 device token；对应原插件 deviceId 的认领排他语义。 |
| fixture | 本地 mock 页面：按生产验证过的淘宝 DOM 结构构建（列表页/详情页/弹窗），用于无登录态环境下的全链路验证。 |
| 弹窗状态机 | C32 置顶确认的优先级判定：替换上限弹窗（B）→ 取消爆品弹窗 → 设置爆品弹窗（A）→ 静默窗成功判定。 |
