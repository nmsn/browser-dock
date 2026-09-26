# packages/shared（规划中）

将来的跨端共享包 `@browser-dock/shared`，当前仅预留目录，尚未创建。

## 演进路径

- 第一步：把 `apps/desktop/src/shared/types.ts` 迁入本包并导出，桌面端改用 `import type { ... } from '@browser-dock/shared'`（type-only 导入在编译期擦除，主进程/预加载/渲染层均零构建改动）。
- NestJS（apps/server）引入后，两端以 `"@browser-dock/shared": "workspace:*"` 声明依赖，共享接口/DTO 契约。
- 若后续需要运行时校验（如 zod schema），再评估给桌面端打包配置增加对应处理；纯类型阶段不需要。

## 约定

- 包名：`@browser-dock/shared`
- `"exports"` 指向 TypeScript 源码（`types` 条目），桌面端经 bundler 处理、server 端经 ts/swc 处理，不预编译。
