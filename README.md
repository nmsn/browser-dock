# Browser Dock

淘宝直播中控台自动化工具

## 技术栈

- Electron 43 + electron-vite 5
- React 19 + TypeScript + shadcn/ui (Base UI)
- Tailwind CSS 4.3
- Zustand / node-cron / better-sqlite3 / pino
- @napi-rs/keyring（系统密钥环）

## 开发

要求 Node.js >= 22.12 与 pnpm >= 9。

```bash
pnpm install
pnpm dev
```

## 打包

```bash
pnpm build           # 仅打包到 out/
pnpm build:mac        # 生成 dmg + zip
```

未配置 Apple 开发者签名，首次打开需右键 → 打开。

## 文档

- [架构设计](docs/project-architecture-design.md)
