# ADR-0004: 账号模型——分区会话、小规模并发、隐藏执行

- 状态：已接受（2026-09-26）
- 背景：原扩展一个浏览器 profile = 一个淘宝账号，不建模多账号。browser-dock 需要多账号并发。
- 决策：
  - 规模：常规 1-2 个，上限 3-5 个账号。并发控制沿用：每账号同时 1 个任务（账号锁）+ 全局 `maxConcurrency`（≤5）。
  - 会话：每账号一个 `persist:account-<id>` 分区，cookie 独立持久化。旧 Chrome profile 登录态不迁移（Chromium cookie 库不通用），每账号重新扫码登录一次。
  - 身份：`accounts` 表新增 `user_num_id` 列；登录成功后页面内 fetch `mtop.user.getusersimple` 捕获（JSONP 重放 + DOM 昵称兜底）。
  - 窗口：执行时默认隐藏（设置可改）；登录时显示供扫码；托盘/账号页可随时显示/隐藏。
  - 风控：UA 伪装为同版本真实 Chrome；开播后先单账号灰度观察。
