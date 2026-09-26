# ADR-0001: 执行宿主采用嵌入式 Electron 窗口

- 状态：已接受（2026-09-26）
- 背景：原 freelive-browser-extension 依赖外部 Chrome 标签页执行淘宝直播自动化，browser-dock 初版沿用外部 Chrome + CDP。业务要求：Electron 应用内执行、最小化执行、多账号、不节流不冷冻。
- 决策：每账号一个 `BaseWindow` + `WebContentsView`，会话分区 `persist:account-<id>`，`backgroundThrottling: false` + app 级防节流 switch + 执行期 `powerSaveBlocker`，执行时窗口默认隐藏。彻底替代外部 Chrome 的进程spawn/CDP target 发现。
- 备选：保留外部 Chrome + CDP（防节流已可用启动参数解决）。否决原因：业务明确要求应用内闭环执行、不依赖用户安装的 Chrome、多账号单进程管理。
- 后果：
  - 复用 ~75-80% 管线（PageAdapter 抽象、调度/日志/取消/并发、stores、IPC、渲染层、page-script vendor）。
  - 重写传输层 ~1100-1600 行（chrome/manager、cdp-client 的 target 发现/帧自动附着、CdpPageAdapter、network 捕获传输）。
  - 跨域 iframe（c48 优惠券弹窗 / smf OOIF）失去 CDP auto-attach 等价物，成为 c48 迁移的前置课题（见 ADR-0005）。
  - 风控指纹：Electron ≠ Chrome，需 UA 伪装（ADR-0004）。
