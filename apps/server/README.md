# apps/server（规划中）

将来引入的 NestJS 服务端，作为 Browser Dock 桌面端的后端服务。当前仅预留目录与约定，尚未初始化。

## 初始化约定

- 由 `@nestjs/cli` 生成基础骨架（`main.ts` / `app.module.ts` 等），包名 `@browser-dock/server`。
- **独立 tsconfig**：需开启 `experimentalDecorators` + `emitDecoratorMetadata`，不继承桌面端（apps/desktop）的 tsconfig。
- 端口约定：默认 `3100`，通过 `.env`（`PORT`）覆盖；`.env` 已被根 .gitignore 忽略。
- 依赖安装：`pnpm -C apps/server add <pkg>`；根目录 `pnpm install` 会统一安装。

## 与桌面端的通信

- 桌面端主进程（`apps/desktop/src/main`）作为 HTTP/WS 客户端访问本服务。
- 共享类型/契约放在 `packages/shared`（`@browser-dock/shared`），两端以 `workspace:*` 依赖、`import type` 引入（类型在编译期擦除，桌面端主进程/预加载/渲染层无需额外构建配置）。
- 引入后在根 package.json 增加对应代理脚本（如 `dev:server`），并评估是否引入 Turborepo 做任务编排。

## CI

引入后需在 `.github/workflows` 增加 server 的 typecheck/build job（`working-directory: apps/server`）。
