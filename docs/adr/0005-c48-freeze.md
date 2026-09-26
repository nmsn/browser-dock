# ADR-0005: c48（优惠券发送）冻结与迁移前置课题

- 状态：已接受（2026-09-26）
- 决策：c48 暂不迁移、不开发；代码保留并标注 deprecated；外部 Chrome 传输层保留（c48 在过渡期仍可运行），待迁移完成后统一删除。
- 最终形态：所有功能（含 c48）在嵌入式执行宿主上运行。
- 迁移前置课题（未来单独立项）：跨域 iframe 寻址。c48 依赖 CDP `Target.setAutoAttach` 的 per-frame 会话（优惠券 iframe `app-live-platform-live-coupon` 与 `smf.taobao.com` OOIF）；Electron 无等价 API，需验证 `webContents.debugger` 的 frame 目标语义，或回退主世界 hook 方案。同理需解决网络响应体捕获（`userBenefitList.do`）。
- 对比：爆品置顶（C32）仅操作主 frame、不依赖网络响应体，完全避开该课题。
