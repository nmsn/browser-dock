# ADR-0002: 里程碑顺序 ①嵌入式+C32本地 → ②NestJS server → ③远端对接

- 状态：已接受（2026-09-26）
- 背景：三条工作流相互依赖：嵌入式 runtime 是 C32 执行的前提；server 契约可独立开发；远端对接依赖前两者。
- 决策：① 嵌入式 runtime + 爆品置顶本地模式（含定时、多账号并发，fixture 全链路验收）→ ② NestJS 12 server（RPA 契约 + 执行记录 + 简化管理 REST，同步抽取 `packages/shared` 契约包）→ ③ 桌面端 run-mode 切换 + poll/claim/report/cancel 客户端。
- 理由：每步有独立可验收产出；①最快验证最高风险项（嵌入式传输层）；server 契约照搬扩展 `docs/rpa-app-docs/12-场控自动化插件接口.md` 语义，可并行推进。
