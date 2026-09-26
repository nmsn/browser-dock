# ADR-0003: NestJS 12 server 范围与设备注册认证

- 状态：已接受（2026-09-26）
- 背景：重写原 freelive 平台后端（ee/leqee 网关 + CAS SSO + OpenAPI md5 签名头）为自己可控的 NestJS 服务。消费方只有 browser-dock 桌面端（现无多端兼容诉求）。
- 决策：
  - 技术栈：NestJS 12（^12，Node ≥20，仓库用 Node 22）+ Drizzle ORM（drizzle-kit 管理迁移，NestJS 侧自定义 Provider 注入）+ PostgreSQL 16 + Swagger；docker-compose 部署公网云主机；端口 3100。
  - 阶段一范围：RPA 四接口（`task/list`、`task/claim`、`task/report`、`task/cancel`）+ 执行记录上传（multipart 截图）+ 简化管理 REST（直播间绑定/计划/配置 CRUD），**纯 API 无 Web 控制台**（附 Swagger）。
  - 认证：设备注册制——桌面端以 deviceId 注册换 device token（继承原 deviceId 的认领排他/自愈语义）；管理端简单 JWT 账号。不保留 ee SSO/CAS/md5 签名。
  - 契约语义（claim 行级 CAS、report 终态 CAS、HOT_ITEM_TOP 服务端重试≤3、错误文案）照搬扩展 `docs/rpa-app-docs/12-场控自动化插件接口.md`。
  - 共享契约：里程碑②开工时抽 `packages/shared`（`@browser-dock/shared`，types-only，两端 `workspace:*` 依赖）。
- 不兼容性：原 freelive-browser-extension 不能直连新 server（接受，插件退役）。
- 实施规格：数据模型（Drizzle schema 草案）与状态机、认证握手、接口语义要点、桌面端对接时序、实施顺序见 `apps/server/README.md`（里程碑②的实现基准文档）；接口层实时文档由 NestJS Swagger 承担。
