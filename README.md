# Browser Dock

淘宝直播中控台自动化工具（pnpm monorepo）

## 结构

```
apps/
  desktop/    # Electron 桌面端（electron-vite + React）
  server/     # NestJS 服务端（规划中，见其 README）
packages/
  shared/     # 跨端共享类型包（规划中，见其 README）
```

## 开发

要求 Node.js >= 22.12 与 pnpm >= 9。

```bash
pnpm install
pnpm dev          # 桌面端开发（等价 pnpm -C apps/desktop dev）
```

根目录脚本均为对 `apps/desktop` 的代理：`build`、`build:mac`、`build:win`、`typecheck`、`lint`、`test:*`。
也可以直接进入 `apps/desktop` 执行同样的脚本。

## 打包

```bash
pnpm build           # 仅打包到 apps/desktop/out/
pnpm build:mac       # 生成 dmg + zip
```

Windows 安装包（nsis）通过 GitHub Actions 在 Windows 环境原生构建：
`.github/workflows/build-windows.yml`（手动触发或推送 `v*` tag），
产物为 x64 exe 安装包。

未配置 Apple 开发者签名，首次打开需右键 → 打开；Windows 首启 SmartScreen 提示属预期。

## 文档

- [架构设计](apps/desktop/docs/project-architecture-design.md)
