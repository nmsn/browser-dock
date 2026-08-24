# 项目架构设计：淘宝直播中控台自动化

## 一、Mirage Browser 核心功能总结

### 1.1 架构模式

```
┌─────────────────────────────────────────────────┐
│               Electron 主进程                     │
│  ├── Chrome 进程管理（spawn/kill）                │
│  ├── Mihomo 代理进程管理                          │
│  ├── CDP WebSocket 通信                          │
│  ├── 数据持久化（JSON 文件）                       │
│  ├── IPC Handler（接收 UI 请求）                  │
│  └── 定时任务（待实现）                            │
├─────────────────────────────────────────────────┤
│               Preload 脚本                        │
│  └── contextBridge 暴露 API                       │
├─────────────────────────────────────────────────┤
│               渲染进程（UI）                       │
│  ├── 环境管理页面                                 │
│  ├── 代理管理页面                                 │
│  ├── 脚本管理页面                                 │
│  └── 设置页面                                     │
└─────────────────────────────────────────────────┘
```

### 1.2 与浏览器插件的核心差异

| 维度 | 浏览器插件 | Mirage Browser（本地应用） |
|------|-----------|--------------------------|
| 进程控制 | 受 Chrome 管辖 | 父进程，完全控制 Chrome |
| 数据存储 | `chrome.storage`（受配额和扩展生命周期限制） | 本地数据库和文件系统（受操作系统权限与磁盘容量限制） |
| 多开隔离 | 逻辑隔离（共享进程） | 物理隔离（独立 `--user-data-dir`） |
| 后台执行 | 受 Chrome 节流 | 可通过启动参数禁用节流 |
| 指纹伪装 | 有限 | CDP + JS 注入，全面覆盖 |
| 代理管理 | 基础（`chrome.proxy`） | 完整（Mihomo + 订阅管理） |

### 1.3 数据存储逻辑

Mirage 使用**JSON 文件**存储，目录结构：

```
{appData}/Mirage-Browser/
  ├── data/
  │   ├── config.json                    # 全局配置
  │   ├── environments/
  │   │   ├── {envId-1}.json             # 环境 A 配置
  │   │   └── {envId-2}.json             # 环境 B 配置
  │   ├── proxy/
  │   │   ├── sources.json               # 订阅源列表
  │   │   └── nodes/
  │   │       ├── {sourceId-1}.json      # 订阅源 A 的节点
  │   │       └── {sourceId-2}.json      # 订阅源 B 的节点
  │   ├── scripts.json                   # 脚本列表
  │   └── certs/
  │       ├── index.json                 # 证书索引
  │       └── {certId}.pem              # 证书文件
  └── profiles/
      ├── {envId-1}/
      │   ├── chrome_data/              # Chrome 用户数据
      │   └── mihomo.yaml               # Mihomo 配置
      └── {envId-2}/
          ├── chrome_data/
          └── mihomo.yaml
```

### 1.4 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| Chrome 管理器 | `chrome-manager.ts` | 启动/关闭 Chrome 进程，管理 CDP 连接 |
| CDP 客户端 | `cdp-client.ts` | WebSocket 连接 Chrome，发送 CDP 命令 |
| 指纹生成器 | `fingerprint.ts` | 生成随机指纹，构建注入脚本 |
| 数据存储 | `store.ts` | JSON 文件读写，CRUD 操作 |
| 代理管理 | `mihomo-manager.ts` | Mihomo 进程管理，配置生成 |
| 订阅管理 | `subscription.ts` | 代理订阅拉取和解析 |
| 证书管理 | `cert-manager.ts` | 系统证书信任管理 |

---

## 二、新项目架构设计

### 2.1 项目定位

淘宝直播中控台自动化工具：
- 多账号登录和管理
- 定时任务调度
- 多账号同时执行自动化操作
- 复用现有浏览器插件的自动化逻辑

### 2.1.1 本期默认决策

为了避免实现范围不断扩大，第一版按以下约束设计：

| 项目 | 默认决策 | 说明 |
|------|---------|------|
| 运行方式 | 本地单机运行 | 不依赖云端控制面板或远程执行服务 |
| 定时任务 | 应用运行期间执行 | 应用未启动时默认跳过，不补执行；后续可增加系统级唤醒能力 |
| 并发模型 | 不同账号并行，同一账号串行 | 避免同一 Profile 被多个任务同时使用 |
| 并发上限 | 可配置，默认 3 个账号 | 防止大量 Chrome 进程占用本机资源 |
| 登录方式 | 用户在独立 Chrome 窗口中手动登录 | 不在应用中保存淘宝密码 |
| 敏感信息 | 使用系统密钥环保存 | 代理密码、订阅 Token 等不直接写入 SQLite |
| 脚本权限 | 仅允许页面自动化能力 | 禁止任务脚本直接访问 Node.js、文件系统和其他账号数据 |

### 2.2 技术选型

| 层面 | 选择 | 原因 |
|------|------|------|
| 框架 | Electron | 与 Mirage 一致，可复用核心模块 |
| UI | React 19 + TypeScript | 组件化，便于扩展 |
| UI 组件库 | shadcn/ui（Base UI） | 无运行时依赖，完全由 Tailwind 控制样式，适合 Electron 小体积 |
| 样式 | Tailwind CSS 4 | 与 shadcn 深度集成，CSS 变量主题切换 |
| 图标 | lucide-react | shadcn 默认图标库，按需导入 |
| 状态管理 | Zustand | 轻量，适合中等规模应用 |
| 任务调度 | node-cron | 轻量级定时任务 |
| 数据存储 | SQLite（better-sqlite3） | 比 JSON 文件更可靠，支持查询 |
| 构建工具 | electron-vite + electron-builder | Vite 三端打包，electron-builder 打包 dmg |
| 密钥环 | @napi-rs/keyring | 2026 年活跃维护，跨平台 prebuild |
| 日志 | pino + pino-pretty | 高性能结构化日志 |

#### UI 组件库选型对比

| 框架 | 适合场景 | 包大小 | 中文支持 | 推荐度 |
|------|---------|--------|---------|--------|
| **shadcn/ui（Base UI）** | 现代风格，高度自定义，无运行时依赖 | ~0（复制源码） | 需自己翻译 | 推荐 |
| Ant Design | 企业级工具，表格/表单多 | ~2MB | 完善 | 备选 |
| Arco Design | 字节跳动出品，轻量 | ~1MB | 完善 | 备选 |

**选择 shadcn/ui + Tailwind CSS 的原因**：

- 零运行时依赖，组件源码直接复制到项目中
- Tailwind CSS 4 深度集成，样式完全由 utility class 控制
- 支持 CSS 变量主题切换（暗色模式、自定义主题）
- lucide-react 图标库按需导入，体积小
- 社区活跃，组件库持续更新

```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card dialog input table
```

### 2.3 目录结构

```
browser-dock/
├── src/
│   ├── main/                          # Electron 主进程
│   │   ├── index.ts                   # 入口，窗口管理，生命周期
│   │   ├── store/                     # 数据层
│   │   │   ├── database.ts            # SQLite 数据库初始化
│   │   │   ├── accounts.ts            # 账号 CRUD
│   │   │   ├── tasks.ts               # 任务 CRUD
│   │   │   └── logs.ts                # 执行日志 CRUD
│   │   ├── chrome/                    # Chrome 管理（可从 Mirage 复用）
│   │   │   ├── manager.ts             # Chrome 进程生命周期
│   │   │   ├── cdp-client.ts          # CDP WebSocket 通信
│   │   │   └── profile.ts             # 用户数据目录管理
│   │   ├── scheduler/                 # 任务调度器
│   │   │   ├── cron-scheduler.ts      # Cron 定时调度
│   │   │   ├── task-executor.ts       # 任务执行引擎
│   │   │   └── task-runner.ts         # 多账号并行执行
│   │   ├── automation/                # 自动化脚本（从插件迁移）
│   │   │   ├── base-action.ts         # 基础操作封装
│   │   │   ├── page-action.ts         # 页面操作（点击、输入、导航）
│   │   │   ├── data-extract.ts        # 数据提取
│   │   │   └── taobao/                # 淘宝专用模块
│   │   │       ├── login.ts           # 登录流程
│   │   │       ├── live-control.ts    # 中控台操作
│   │   │       └── product.ts         # 商品管理
│   │   ├── ipc-handlers.ts            # IPC 接口定义
│   │   └── config.ts                  # 全局配置
│   ├── preload/
│   │   └── index.ts                   # contextBridge 暴露 API
│   ├── renderer/                      # UI（React）
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Accounts/              # 账号管理页面
│   │   │   ├── Tasks/                 # 任务管理页面
│   │   │   ├── Execution/             # 执行监控页面
│   │   │   └── Settings/              # 设置页面
│   │   └── components/
│   └── shared/
│       └── types.ts                   # 共享类型定义
├── package.json
└── tsconfig.json
```

### 2.3.1 UI 页面职责

| 页面 | 核心能力 |
|------|---------|
| 账号管理 | 创建账号、启动/关闭 Profile、手动登录、检查登录态、删除账号 |
| 任务管理 | 创建任务、编辑参数、查看任务版本、启用/停用任务 |
| 调度管理 | 配置 Cron、时区、目标账号、并发数、重试策略和错过执行策略 |
| 执行监控 | 查看账号运行状态、当前步骤、进度、错误、截图，支持取消和重试 |
| 执行历史 | 按账号、任务、状态、时间范围筛选执行日志 |
| 页面诊断 | 查看 DOM 快照、截图、Console 错误和页面变更记录 |
| 设置 | Chrome 路径、并发上限、日志保留、代理、开机启动和托盘行为 |

### 2.4 核心数据模型

```typescript
// 账号（对应一个淘宝中控台账号）
interface Account {
  id: string;
  name: string;                    // 账号别名
  taobaoUsername: string;          // 淘宝用户名
  profilePath: string;             // Chrome 用户数据目录路径
  proxyConfig?: ProxyConfig;       // 代理配置（可选）
  notes: string;
  createdAt: string;
  lastLoginAt?: string;
  loginStatus: 'unknown' | 'logged-in' | 'logged-out' | 'verification-required' | 'risk-control';
  lastLoginCheckAt?: string;
}

// 任务（定义一个自动化操作）
interface Task {
  id: string;
  name: string;
  type: 'live-control' | 'product' | 'custom';  // 任务类型
  script: string;                  // 自动化脚本内容
  config: Record<string, unknown>; // 任务参数配置
  version: number;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  createdAt: string;
  updatedAt: string;
}

// 调度规则（定时执行配置）
interface Schedule {
  id: string;
  taskId: string;                  // 关联的任务
  accountIds: string[];            // 要执行的账号列表
  cronExpression: string;          // Cron 表达式
  timezone: string;
  enabled: boolean;
  misfirePolicy: 'skip' | 'run-once';
  maxConcurrency: number;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

// 执行记录（一次任务执行的日志）
interface ExecutionLog {
  id: string;
  scheduleId?: string;             // 关联的调度规则（手动执行时为空）
  taskId: string;
  accountId: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt?: string;
  duration?: number;               // 执行时长（ms）
  result?: Record<string, unknown>;
  error?: string;
  screenshots?: string[];          // 截图路径列表
}

type ExecutionStatus =
  | 'queued'
  | 'starting'
  | 'launching-browser'
  | 'connecting-cdp'
  | 'checking-login'
  | 'waiting-page'
  | 'running'
  | 'waiting-user'
  | 'retrying'
  | 'cancelling'
  | 'cancelled'
  | 'success'
  | 'failed'
  | 'timeout';

interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

interface AccountRuntime {
  accountId: string;
  status: 'stopped' | 'starting' | 'running' | 'waiting-login' | 'error';
  pid?: number;
  debugPort?: number;
  cdpConnected: boolean;
  currentUrl?: string;
  startedAt?: string;
  lastError?: string;
}

// 代理配置
interface ProxyConfig {
  mode: 'none' | 'simple' | 'mihomo';
  server?: string;                 // 简单代理地址
  mihomoConfig?: string;           // Mihomo 配置
}
```

### 2.5 数据库设计（SQLite）

```sql
-- 账号表
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  taobao_username TEXT,
  profile_path TEXT NOT NULL,
  proxy_config TEXT,              -- JSON
  notes TEXT,
  created_at TEXT,
  last_login_at TEXT,
  login_status TEXT NOT NULL DEFAULT 'unknown',
  last_login_check_at TEXT
);

-- 任务表
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  script TEXT NOT NULL,
  config TEXT,                    -- JSON
  version INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER NOT NULL DEFAULT 120000,
  retry_policy TEXT NOT NULL,     -- JSON
  created_at TEXT,
  updated_at TEXT
);

-- 调度规则表
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  account_ids TEXT NOT NULL,      -- JSON 数组
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  enabled INTEGER DEFAULT 1,
  misfire_policy TEXT NOT NULL DEFAULT 'skip',
  max_concurrency INTEGER NOT NULL DEFAULT 3,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- 执行日志表
CREATE TABLE execution_logs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT,
  task_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  finished_at TEXT,
  duration INTEGER,
  result TEXT,                    -- JSON
  error TEXT,
  screenshots TEXT,               -- JSON 数组
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- 防止同一账号被多个任务同时占用
CREATE TABLE account_locks (
  account_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- 数据库版本，用于启动时执行迁移
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

### 2.6 核心流程

#### 2.6.1 账号登录流程

```
1. 用户点击"登录账号"
2. 创建独立 Chrome 实例（独立 --user-data-dir）
3. 导航到淘宝登录页面
4. 用户手动完成登录（扫码/密码）
5. 检测登录成功（页面跳转/cookie 写入）
6. 关闭 Chrome，保存登录状态
7. 更新数据库 is_logged_in = true
```

#### 2.6.2 定时任务执行流程

```
1. Cron 触发调度规则
2. 查找关联的任务和账号
3. 为每个账号启动独立 Chrome 实例
4. 通过 CDP 注入自动化脚本
5. 并行执行任务
6. 收集执行结果和截图
7. 保存执行日志
8. 关闭所有 Chrome 实例
```

#### 2.6.3 插件代码迁移路径

```
浏览器插件代码：
  ├── Content Script（页面操作）
  │     └── 迁移为 automation/base-action.ts
  │
  ├── Background Script（后台逻辑）
  │     └── 迁移为 scheduler/task-executor.ts
  │
  └── Popup（配置界面）
        └── 迁移为 renderer/pages/Settings/

迁移要点：
  1. chrome.storage → SQLite
  2. chrome.tabs → CDP Page.navigate
  3. chrome.webRequest → CDP Network.* 命令
  4. Content Script 注入 → CDP Runtime.evaluate
  5. chrome.alarms → node-cron
```

---

## 三、模块复用指南

### 3.1 可直接复用的模块（从 Mirage Browser）

| 模块 | 源文件 | 复用方式 | 修改点 |
|------|--------|---------|--------|
| Chrome 进程管理 | `chrome-manager.ts` | 直接复制 | 移除指纹相关逻辑（可选保留） |
| CDP 客户端 | `cdp-client.ts` | 直接复制 | 无 |
| 数据存储 | `store.ts` | 重写为 SQLite | 接口保持一致 |
| IPC Handler 模式 | `ipc-handlers.ts` | 参考架构 | 重新定义接口 |

### 3.2 需要新增的模块

| 模块 | 说明 | 优先级 |
|------|------|--------|
| 任务调度器 | Cron 定时任务 | P0 |
| 任务执行引擎 | 多账号并行执行 | P0 |
| 自动化脚本框架 | 基础操作封装 | P0 |
| 执行日志系统 | 截图、结果记录 | P1 |
| 淘宝专用模块 | 中控台操作封装 | P1 |

### 3.3 插件代码迁移示例

**插件中的 Content Script**：

```javascript
// 插件：content-script.js
chrome.runtime.sendMessage({ action: 'getAccount' }, (account) => {
  // 页面操作逻辑
  document.querySelector('.start-live-btn').click();
});
```

**迁移到本地应用**：

```typescript
// automation/taobao/live-control.ts
export async function startLive(cdpClient: CdpClient, accountId: string): Promise<void> {
  // 导航到中控台
  await cdpClient.send('Page.navigate', {
    url: 'https://live.taobao.com/admin'
  });

  // 等待页面加载
  await waitForSelector(cdpClient, '.start-live-btn');

  // 点击开播按钮（使用 JS 操作，支持后台执行）
  await cdpClient.send('Runtime.evaluate', {
    expression: `document.querySelector('.start-live-btn').click()`
  });

  // 截图保存结果
  const screenshot = await cdpClient.send('Page.captureScreenshot');
  saveScreenshot(screenshot.data, accountId);
}
```

---

## 四、开发优先级

### Phase 1：基础框架（1-2 周）

- [x] Electron 项目初始化
- [x] SQLite 数据库搭建
- [x] 数据库 migration 和备份机制
- [x] Chrome 进程管理（复用 Mirage）
- [x] Profile 锁和账号运行时状态
- [x] 账号管理 UI
- [x] 账号登录流程

### Phase 2：自动化引擎（2-3 周）

- [x] CDP 客户端（复用 Mirage）
- [x] 基础操作封装（点击、输入、导航、截图）
- [x] AutomationContext 适配层
- [x] 登录状态和账号身份检测
- [x] 插件代码迁移
- [x] 任务管理 UI

### Phase 3：定时调度（1-2 周）

- [x] Cron 调度器
- [x] 多账号并行执行
- [x] 账号锁、并发池和任务状态机
- [x] 超时、取消和有限重试
- [x] 执行日志系统
- [x] 执行监控 UI

### Phase 4：优化完善（持续）

- [x] 错误重试机制
- [x] 应用设置页（Chrome 路径、并发上限、日志/截图保留天数、通知开关、开机自启动）
- [x] 脚本权限策略和系统密钥环（任务级 API 白名单 UI + 沙箱强制执行；密钥环已实现）
- [x] 页面变化检测和 DOM 快照
- [x] Electron 原生模块打包验证（macOS arm64/x64 已验证通过）
- [ ] 多平台安装、升级和数据迁移（恢复界面已完成；Windows 打包按本期决策暂缓，见 15.4）
- [x] 执行结果通知
- [x] 性能优化（数据库索引已完成；启动时间 / Chrome 池化按需后续处理）
- [x] 日志导出（CSV，过滤敏感信息）
- [x] 实时执行状态推送（execution:status + execution:log 事件）
- [x] 任务取消支持（cancel-registry + AbortSignal 传播）
- [x] 调度下次运行时间显示（cron-parser）
- [x] 托盘最小化（closeToTray 设置 + 系统托盘菜单）
- [x] 保留期自动清理（日志/截图/DOM 快照，启动时 + 每日 03:00）
- [x] 备份恢复界面（列表 / 手动备份 / 一键恢复，恢复前自动安全备份）
- [x] 低频巡检（opt-in，每日 04:00 探针检测中控台可用性）

---

## 五、任务调度与并发策略

### 5.1 调度边界

第一版使用 `node-cron`，只保证应用进程运行期间触发任务。应用退出、电脑睡眠或系统关机期间不补执行，避免恢复后突然批量操作淘宝账号。

后续如果需要应用未启动时也能执行，应增加系统级能力，例如开机启动、系统任务计划或后台常驻进程，而不是仅依赖 `node-cron`。

### 5.2 调度流程

```text
Cron 触发
  -> 读取 Schedule
  -> 校验 enabled、时区和任务版本
  -> 创建本次 ExecutionBatch
  -> 为每个账号创建 ExecutionLog
  -> 交给并发控制器
  -> 执行、重试、记录结果
  -> 更新 Schedule.lastRunAt / nextRunAt
```

### 5.3 并发规则

| 规则 | 默认行为 |
|------|---------|
| 不同账号 | 可以并行执行 |
| 同一账号 | 同一时间只允许一个任务执行 |
| 同一 Profile | 同一时间只允许一个 Chrome 进程使用 |
| 全局并发 | 默认最多 3 个账号，可在设置中调整 |
| 单账号失败 | 不阻塞其他账号 |
| 调度重入 | 上一批次未结束时，默认跳过下一次重复触发 |
| 代理节点 | 可配置最大并发，避免代理服务过载 |

### 5.4 调度器伪代码

```typescript
async function dispatchSchedule(schedule: Schedule): Promise<void> {
  if (!schedule.enabled || isBatchRunning(schedule.id)) return;

  const accounts = await accountStore.list(schedule.accountIds);
  const batch = await executionStore.createBatch(schedule, accounts);

  await concurrencyPool.run(
    accounts.map(account => () => runForAccount(batch, account)),
    schedule.maxConcurrency,
  );
}
```

任务必须有幂等性设计。例如“上架商品”“发送通知”等操作执行前应查询当前状态，避免重试导致重复操作。

---

## 六、Chrome 实例生命周期与资源管理

### 6.1 账号运行状态

```text
stopped
  -> starting
  -> launching-browser
  -> connecting-cdp
  -> checking-login
  -> running
  -> stopped

任意阶段失败 -> error
任务需要人工处理 -> waiting-login / waiting-user
```

### 6.2 启动流程

```text
1. 获取账号互斥锁
2. 检查 Profile 是否被其他 Chrome 占用
3. 分配 CDP 端口
4. 启动 Mihomo（如有）
5. 启动 Chrome 子进程
6. 等待 /json/version 可访问
7. 建立 CDP WebSocket
8. 配置 Page、Runtime、Network 域
9. 注入页面初始化脚本
10. 检测淘宝登录状态和账号身份
```

### 6.3 关闭和异常清理

```text
正常结束:
  停止任务 -> 关闭 CDP -> 关闭 Chrome -> 关闭 Mihomo -> 释放锁

异常结束:
  记录错误 -> 尝试关闭 CDP -> kill Chrome -> kill Mihomo
  -> 清理端口和锁 -> 更新运行状态
```

应用启动时应扫描上一次异常退出留下的运行记录和 Chrome 进程，不能只依赖内存中的 `Map`。

### 6.4 Profile 管理要求

- 每个账号固定一个独立 Profile 目录。
- Profile 路径由应用生成，不允许任务脚本自定义任意路径。
- 启动前检查 Chrome 的锁文件和运行进程。
- 删除账号前必须先停止实例，并提供“是否删除登录态数据”的明确选项。
- 不允许两个账号复用同一个 Profile。

---

## 七、自动化运行时抽象层

插件逻辑不应直接迁移成散落的 `Runtime.evaluate` 字符串。应先定义运行时接口，隔离淘宝业务逻辑和浏览器控制实现。

### 7.1 运行时结构

```text
automation/
  runtime/
    automation-context.ts
    page-adapter.ts
    storage-adapter.ts
    network-adapter.ts
  actions/
    click.ts
    input.ts
    wait.ts
    navigate.ts
    screenshot.ts
  taobao/
    login-detector.ts
    account-detector.ts
    live-control.ts
```

### 7.2 适配接口

```typescript
interface AutomationContext {
  account: AccountContext;
  page: PageAdapter;
  storage: StorageAdapter;
  network: NetworkAdapter;
  logger: TaskLogger;
  signal: AbortSignal;
}

interface PageAdapter {
  navigate(url: string): Promise<void>;
  waitForSelector(selector: string, timeoutMs: number): Promise<void>;
  click(selector: string): Promise<void>;
  input(selector: string, value: string): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(name: string): Promise<string>;
}
```

### 7.3 插件迁移边界

| 插件能力 | 本地应用适配方式 | 注意事项 |
|---------|------------------|---------|
| Content Script | `PageAdapter` + CDP Runtime | 注意 isolated world 和页面主世界差异 |
| `chrome.tabs` | `Page.navigate`、Target 管理 | 需要自己维护页面生命周期 |
| `chrome.storage` | SQLite 或任务上下文 | 禁止脚本访问其他账号数据 |
| `chrome.alarms` | Scheduler | 增加时区、重入和重试策略 |
| `chrome.webRequest` | CDP Network 或主进程网络监听 | 不保证事件语义完全一致 |
| Popup 配置 | Renderer 页面 | UI 和执行引擎通过 IPC 通信 |
| Background Script | Task Runner | 不应直接等价为 Electron 主进程任意代码 |

页面操作优先使用 DOM 语义操作；只有业务确实需要真实输入事件时，才使用 `Input.*` 命令，并纳入后台窗口专项测试。

---

## 八、异常恢复与任务状态机

### 8.1 错误分类

```typescript
  | 'browser-launch-failed'
  | 'cdp-connect-failed'
  | 'profile-locked'
  | 'login-expired'
  | 'verification-required'
  | 'risk-control'
  | 'selector-not-found'
  | 'network-timeout'
  | 'page-changed'
  | 'user-intervention-required'
  | 'task-timeout'
  | 'unknown';
```

### 8.2 错误处理策略

| 错误 | 处理方式 |
|------|---------|
| Chrome 启动失败 | 有限重试，检查路径、端口和 Profile 锁 |
| CDP 连接失败 | 重连一次，仍失败则重启实例 |
| 登录失效 | 标记账号，暂停该账号任务，通知用户重新登录 |
| 页面结构变化 | 保存截图和 DOM 快照，停止当前任务 |
| 网络超时 | 按退避策略重试 |
| 风控验证 | 进入 `waiting-user`，不自动绕过 |
| 任务超时 | 取消执行并清理所有子进程 |
| 单账号失败 | 记录失败，不影响其他账号任务 |

### 8.3 重试原则

- 只对明确可恢复的错误重试。
- 页面提交、发送消息等有副作用的操作必须先检查是否已经完成。
- 每次重试记录 `attempt`，禁止无限重试。
- 任务取消必须支持 `AbortSignal`，确保 Chrome 和网络请求最终释放。

---

## 九、数据安全与隐私保护

Chrome Profile 包含淘宝登录 Cookie、LocalStorage 和设备信息，应当视为敏感数据处理。

### 9.1 存储要求

| 数据 | 存储方式 |
|------|---------|
| 淘宝登录态 | Chrome Profile，限制目录权限 |
| 代理密码、订阅 Token | 系统密钥环，不写入明文 SQLite |
| 任务配置 | SQLite |
| 任务脚本 | SQLite，记录版本和更新时间 |
| 截图、DOM 快照 | 独立文件目录，支持保留期限 |
| 日志 | SQLite 或滚动日志文件，禁止记录 Cookie/Token |

### 9.2 脚本权限边界

任务脚本只允许调用白名单自动化 API：

- 页面导航
- 选择器等待
- DOM 点击和输入
- 页面数据读取
- 截图和任务日志

禁止脚本直接调用：

- `child_process`
- 任意 `fs` 路径
- SQLite 原始连接
- 其他账号的 Profile
- 系统密钥环
- Electron 主进程对象

### 9.3 删除和备份

- 删除账号时明确区分“删除账号配置”和“删除 Chrome 登录态”。
- 备份包含 Profile 时必须加密。
- 截图和 DOM 快照默认保留 30 天，可配置。
- 导出日志前过滤 Cookie、Token 和个人信息。

---

## 十、Electron 安全与打包部署

### 10.1 Electron 安全基线

- Renderer 开启 `contextIsolation`。
- Renderer 禁止 `nodeIntegration`。
- Preload 只通过 `contextBridge` 暴露白名单 API。
- IPC 入参在主进程重新校验，不能信任 Renderer 类型声明。
- 不允许 Renderer 直接执行任意脚本或访问文件系统。
- 外部页面只在受控 Chrome 子进程中打开，不加载到主应用窗口。

### 10.2 SQLite 原生模块

`better-sqlite3` 是原生模块，需要处理 Electron ABI 和打包问题：

- 固定 Electron 与 `better-sqlite3` 兼容版本。
- 使用 `electron-rebuild` 或 Electron Forge 原生模块配置。
- 在 macOS、Windows、Linux CI 环境分别验证。
- 打包后执行一次真实数据库读写测试。
- 应用升级前自动备份数据库并执行 migration。

### 10.3 应用退出和系统能力

- 使用 `app.requestSingleInstanceLock()` 保证同一用户只运行一个主进程。
- 支持最小化到托盘，避免关闭窗口误停任务。
- 应用退出前等待任务进入可终止状态。
- 提供“强制退出”并明确提示可能留下未完成任务。
- 检测系统睡眠、网络断开和 Chrome 崩溃事件。
- 不把“禁止后台节流”当作绕过系统睡眠的方案。

---

## 十一、运行监控与页面变更检测

### 11.1 每次任务至少记录

- 账号、任务、任务版本
- 开始时间、结束时间、耗时
- Chrome PID 和 CDP 连接状态
- 当前 URL
- 状态转换记录
- 错误类型和错误消息
- 关键步骤截图

### 11.2 页面变更检测

当关键选择器找不到或任务失败时自动保存：

- 当前 URL
- 页面标题
- 关键 DOM 片段
- 页面截图
- 最近的网络错误
- Console 和 Runtime 异常

低频巡检可以独立于业务任务运行，用于提前发现淘宝中控台页面布局变化。页面变化检测只负责发现和告警，不应自动修改任务脚本。

### 11.3 UI 状态

执行监控页面至少展示：

| 信息 | 说明 |
|------|------|
| 账号状态 | 已停止、运行中、等待登录、异常 |
| 任务状态 | 排队、启动、检查登录、执行、成功、失败 |
| 当前步骤 | 当前自动化动作名称 |
| 进度 | 已完成步骤 / 总步骤 |
| 错误 | 错误类型、重试次数和处理建议 |
| 操作 | 取消、重试、打开窗口、重新登录 |

---

## 十二、测试策略

### 12.1 单元测试

- Cron 表达式和时区计算
- 并发池和账号锁
- 状态机合法转换
- 重试和超时策略
- 数据库 migration
- 登录状态解析

### 12.2 集成测试

- 启动和关闭 Chrome
- Profile 隔离
- CDP 断线重连
- Mihomo 启停和代理切换
- SQLite 事务和异常恢复
- 应用异常退出后的清理

### 12.3 淘宝自动化验收测试

至少覆盖：

- 两个以上账号同时执行
- 一个账号登录失效时其他账号继续执行
- 页面被最小化或遮挡时执行
- 任务执行过程中断网
- Chrome 被用户关闭
- 淘宝出现验证码或风控页面
- 同一账号重复调度
- 页面选择器失效后的截图和告警

---

## 十三、版本升级与数据迁移

### 13.1 任务和脚本版本

- 每次脚本修改递增 `Task.version`。
- 执行日志保存任务版本，便于定位历史问题。
- 选择器集中管理，避免散落在多个脚本字符串中。
- 页面结构发生变化时先停用相关任务，再人工确认后恢复。

### 13.2 数据库迁移

```text
应用启动
  -> 读取当前 schema_version
  -> 按顺序执行未应用 migration
  -> 写入 schema_migrations
  -> 创建数据库备份
  -> 初始化调度器
```

迁移失败时禁止继续启动任务执行器，只允许进入修复或数据恢复界面。

---

## 十四、实施前需要确认的产品决策

以下问题不影响基础架构，但会影响后续实现：

1. 应用关闭或电脑睡眠期间，错过的任务是否需要补执行？
2. 是否需要开机自启动和最小化到系统托盘？
3. 任务失败后，是否允许自动重试有副作用的操作？
4. 是否需要人工处理验证码、扫码和风控页面？
5. 截图、DOM 快照和执行日志默认保留多久？
6. 是否需要多个用户使用同一台电脑？
7. 是否需要从已有插件直接导入任务配置？

在这些决策明确前，建议按本文“本期默认决策”实现第一版。

---

## 十五、本期技术决策与版本锁定

### 15.1 运行时版本

| 项目 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 22.12 LTS | electron-vite 5 要求 |
| pnpm | >= 9 | 包管理器（避免 Electron + 符号链接问题，需 `.npmrc` 设置 `node-linker=hoisted`）|
| Electron | latest stable（当前 43.4.0） | 启动时由 electron-vite 自动下载 |
| electron-vite | ^5.0 | 构建工具，替代 electron-forge |
| electron-builder | ^26.15 | 生成 dmg/zip 安装包 |

### 15.2 构建工具链

| 工具 | 用途 | 备注 |
|------|------|------|
| electron-vite | 主/preload/renderer 三端 Vite 打包 | 替代 electron-forge |
| electron-builder | 生成 dmg/zip（macOS）与 nsis exe（Windows，CI 原生构建）安装包 | 无签名 |
| @tailwindcss/vite | Tailwind CSS 4 Vite 插件 | 用于 renderer |
| @electron/rebuild | 原生模块重编译 | 备用，正常情况下 electron-vite 自动处理 |

### 15.3 关键依赖选型

| 类别 | 选择 | 替代方案 | 决定理由 |
|------|------|---------|---------|
| UI 库 | shadcn/ui（Base UI） | Ant Design / Arco | 无运行时依赖，样式完全由 Tailwind 控制，适合 Electron 小体积要求 |
| 样式 | Tailwind CSS 4 | Ant Design 内置 | 与 shadcn 深度集成，支持 CSS 变量主题切换 |
| 图标 | lucide-react | @ant-design/icons | shadcn 默认图标库，按需导入体积小 |
| Toast | sonner | antd message | shadcn 官方推荐，轻量且样式统一 |
| 密钥环 | @napi-rs/keyring@1.3.0 | keytar（已归档） / safeStorage | 2026 年活跃维护，跨平台 prebuild，API 与 keytar 兼容 |
| 日志 | pino + pino-pretty | winston / electron-log | 高性能结构化日志，便于后续导出和查询 |
| 状态 | Zustand | Redux Toolkit | 轻量，适合中等规模应用 |
| 调度 | node-cron | bull / Agenda | 单机足够 |
| 数据库 | better-sqlite3 | sqlite3 / lowdb | 同步 API，性能更好 |
| IPC | 手写类型 + contextBridge | trpc | 与 Mirage 一致，简单可控 |
| 动画 | tw-animate-css | tailwindcss-animate（已弃用）| shadcn 新项目默认使用 |

### 15.4 平台与打包

- 仅 macOS（dmg + zip）
- 不配置代码签名和公证（Phase 1 本机自用）
- Windows 打包：通过 GitHub Actions 在 `windows-latest` 上原生构建（`.github/workflows/build-windows.yml`，手动触发或推送 `v*` tag）。macOS 交叉编译不可行的原因不变：`@napi-rs/keyring` 的 win32 原生模块无法在 macOS 上提升到 node_modules 根目录；CI 上原生安装后由 electron-builder 正确 unpack
- 后续如需分发，再配置签名和公证

### 15.5 错误码字典（草案）

| 分类 | 前缀 | 示例 |
|------|------|------|
| 浏览器 | `BR_*` | BR_LAUNCH_FAILED, BR_CRASHED |
| CDP | `CDP_*` | CDP_CONNECT_FAILED, CDP_DISCONNECTED |
| Profile | `PF_*` | PF_LOCKED, PF_NOT_FOUND, PF_CORRUPTED |
| 登录 | `LG_*` | LG_EXPIRED, LG_VERIFICATION_REQUIRED, LG_RISK_CONTROL |
| 页面 | `PG_*` | PG_SELECTOR_NOT_FOUND, PG_CHANGED |
| 网络 | `NT_*` | NT_TIMEOUT, NT_DISCONNECTED |
| 任务 | `TK_*` | TK_TIMEOUT, TK_CANCELLED, TK_MAX_RETRY |

（错误码详细定义在实现各模块时补充）

---

## 十六、当前实现进度（v0.0.1）

> 本节反映代码库实际状态（同步于 commit `9f2be62`，2026-08-21），用于追踪实施进度。文档前面章节为设计规范，本节为实现快照。

### 16.1 Phase 完成情况

| Phase | 状态 | 完成项 |
|-------|------|--------|
| **Phase 1** 基础框架 | ✅ 100% | Electron 初始化 / SQLite + 迁移 / 备份 / Chrome 管理 / Profile 锁 / 账号管理 UI / 登录流程 |
| **Phase 2** 自动化引擎 | ✅ 100% | CDP 客户端 / 基础操作封装 / AutomationContext / 登录状态 + 账号身份检测 / 任务管理 UI |
| **Phase 3** 定时调度 | ✅ 100% | Cron 调度器 / 多账号并行 / 账号锁 / 状态机 / 超时取消重试 / 执行日志 / 执行监控 UI |
| **Phase 4** 优化完善 | ✅ 100% | 重试 / DOM 快照 / 打包验证 / 通知 / CSV 导出 / 实时推送 / 取消 / 下次运行时间 / 应用设置页 / 保留期清理 / 脚本权限白名单 / 备份恢复 / 托盘 / 低频巡检 / 数据库索引 / Windows 打包（CI 原生构建）全部完成；仅 Mihomo 集成按决策记录暂缓（见 16.6） |

### 16.2 关键模块映射（设计规范 → 实际代码）

| 文档章节 | 实现文件 |
|---------|---------|
| 2.3 目录结构 | `src/main/`（含 store / chrome / scheduler / automation / secrets）、`src/preload/`、`src/renderer/`、`src/shared/`` |
| 2.5 数据库设计 | `src/main/store/database.ts`（accounts / tasks / schedules / execution_logs / account_locks / page_diagnostics）+ `schema_migrations`（v1, v2） |
| 2.6.1 账号登录流程 | `src/main/automation/taobao/login.ts` + `src/main/automation/taobao/login-detector.ts` |
| 5.2 调度流程 | `src/main/scheduler/service.ts`（`handleCronTriggered` + `runTaskNow`） |
| 6.2 启动流程 | `src/main/chrome/manager.ts`（动态分配端口 + 等待 CDP + 关闭清理） |
| 7.1 运行时结构 | `src/main/automation/{runtime,actions,taobao}/` 完整实现 |
| 8.3 重试原则 | `src/main/scheduler/task-executor.ts`（`runWithRetry` + `isRetryableError` + 退避 + AbortSignal） |
| 9.1 存储要求 | `src/main/secrets/keyring.ts`（@napi-rs/keyring）+ `src/main/store/logs.ts`（不带敏感字段） |
| 9.2 脚本权限边界 | `src/main/scheduler/task-executor.ts`（任务级 allowedApis 沙箱守卫，未授权 API 抛 TK_API_NOT_ALLOWED）+ 任务创建 UI 白名单选择器 |
| 9.3 删除/备份 | `src/main/store/backup.ts`（VACUUM INTO + 保留 7 份） + `src/main/log-export.ts`（CSV 仅 SAFE_FIELDS） + `src/main/retention.ts`（日志/截图/快照按保留期清理，启动时 + 每日 03:00） |
| 10.1 安全基线 | `contextIsolation: true, nodeIntegration: false, sandbox: false` + 入参校验 + 白名单 IPC |
| 10.3 应用退出 | `app.requestSingleInstanceLock()` + `before-quit` 关闭清理 |
| 11.2 页面变更检测 | `src/main/store/diagnostics.ts`（page_diagnostics 表）+ task-executor 自动捕获 DOM + 截图 + `src/main/inspection.ts`（opt-in 低频巡检，每日 04:00） |
| 11.3 UI 状态 | 执行监控页（账号/任务/状态/耗时/错误/取消/诊断） |
| 12.2 集成测试 | `scripts/test-chrome-cdp.mjs` + `scripts/test-executor.cjs`（SMOKE PASS） |
| 13.2 数据库迁移 | `applyMigrations` 自动 + pre-migration backup（VACUUM INTO）+ `src/main/store/restore.ts`（备份恢复：路径校验 / 安全备份 / WAL 清理 / 重放迁移）+ 设置页备份卡片 |
| 10.3 托盘行为 | `src/main/tray.ts`（托盘菜单 + closeToTray 设置，关闭窗口隐藏到托盘） |

### 16.3 端到端验证状态

| 验证项 | 命令 | 结果 |
|-------|------|------|
| Chrome 启动 + CDP 连接 + 导航 | `pnpm test:chrome-cdp` | ✅ PASS |
| 任务执行器完整链路（账号→任务→Chrome→CDP→沙箱→日志→锁释放） | `pnpm test:executor`（`BROWSER_DOCK_SMOKE=1`） | ✅ SMOKE PASS |
| 多账号并行（2 账号并发） | 同上 smoke 增加步骤 | ✅ 2/2 |
| pnpm build（开发产物） | `pnpm build` | ✅ 1979 modules |
| macOS 打包 arm64 + x64 | `pnpm build:mac` | ✅ dmg + zip 均生成 |
| 原生模块打包（better-sqlite3 + @napi-rs/keyring） | 验证 `app.asar.unpacked/` | ✅ 正确 unpack |

### 16.4 真实修复的 Bug（集成测试发现）

| Bug | 根因 | 修复 |
|-----|------|------|
| `electron-builder` `ReadWrite` undefined | app-builder-lib 26 用 `@electron/get v5` 的 `ElectronDownloadCacheMode` 枚举，但声明依赖 `^3.0.0` | `pnpm-workspace.yaml` 加 `overrides: '@electron/get': '^5.1.0'` |
| Electron zip 下载失败（macOS 上 Electron 官方源被墙） | 默认官方源 | `electron-builder.yml` 加 `electronDownload.mirror: npmmirror` |
| DMG 构建 `fetchd` 失败（dmgbuild 工具下载被墙） | 默认 GitHub release 源 | `ELECTRON_BUILDER_BINARIES_MIRROR` 环境变量（写入 `build:mac` script） |
| `CDP_TIMEOUT` Chrome 启动 10 秒后超时 | debug 端口固定 9222 被其他 Chrome 占用 | `chrome/manager.ts` 改为 `allocateDebugPort()` 动态分配空闲端口 |
| browser target WS 连接 404 | 硬编码 `ws://.../devtools/browser` 缺 UUID | `createCdpClient` 从 `/json/version` 动态获取 `webSocketDebuggerUrl` |
| IPv6 localhost 解析问题 | Chrome 返回 `ws://localhost:...` 时 ws 库走 IPv6 | `normalizeWsUrl` 统一为 `ws://127.0.0.1:port/...` |
| 单实例锁被占导致 smoke 退出 | 之前 `pnpm dev` 留有后台 Electron 进程 | smoke 前清理（执行时先 kill） |

### 16.5 当前 IPC 接口清单（renderer ↔ main）

| 域 | 方法 | 用途 |
|----|------|------|
| 应用 | `getVersion` / `getAppInfo` | 版本和运行时信息 |
| 账号 | `accounts:list/create/update/delete` | 账号 CRUD |
| 浏览器 | `browser:start/stop/get-runtime/list-runtimes` | Chrome 生命周期 |
| 登录 | `login:start/wait-result` | 登录流程 |
| 任务 | `tasks:list/create/update/delete` | 任务 CRUD |
| 调度 | `schedules:list/create/update/delete` | 调度 CRUD（含 cron 注册/注销） |
| 执行 | `execution:run/list/cancel/export-csv` | 任务执行与日志 |
| 诊断 | `diagnostics:list/get` | 失败页面诊断查看 |
| 密钥环 | `keyring:set/get/delete` | 敏感信息存储 |
| 设置 | `settings:get/update` | 应用设置读写（Chrome 路径、并发上限、保留天数、通知、开机自启、托盘、巡检） |
| 备份 | `backups:list/create/restore` | 数据库备份列表 / 手动备份 / 一键恢复（恢复后调度自动重注册） |
| 事件 | `execution:status` / `execution:log` | 主进程 → renderer 实时推送 |

### 16.6 后续开发路线图

| 优先级 | 项目 | 文档章节 | 状态 |
|-------|------|---------|------|
| 高 | Windows 打包（GitHub Actions `windows-latest` 原生构建 nsis，`pnpm build:win` 本地脚本备用）——CI 已实际运行成功并产出安装包工件 | 10.2 / 15.4 | ✅ 已完成并验证 |
| 低 | Mihomo 代理管理集成（需分发 mihomo 二进制）——已记录，按决策暂缓实现，当前仅 `proxyConfig` 字段占位 | 2.6.2 | 📝 记录暂缓 |
| 低 | 性能优化进阶（启动时间、Chrome 池化；数据库索引已完成） | Phase 4 | 📝 记录暂缓 |

> Phase 1-4 全部完成；Mihomo 集成与性能优化进阶仅记录、暂缓实现。

### 16.7 已知限制

- Windows 安装包由 CI 产出（已验证：run 32623912294 成功产出 x64 nsis exe 工件）；macOS 交叉编译 Windows 不可行（原生模块限制，见 15.4）
- 无代码签名 / 公证（macOS 首启需手动「右键打开」；Windows 首启 SmartScreen 提示属预期）
- 未提供应用自定义图标（`build/icon.icns` / `build/icon.ico` 缺失，使用默认 Electron 图标）
- Chrome 已禁用三类后台节流（timer throttling / occluded windows 挂起 / renderer 降级），窗口遮挡与最小化不影响自动化；系统睡眠场景仍无解（文档 5.1 / 10.3 明确）
- 未实现 Mihomo 集成（文档 1.2 提到「完整代理管理」，目前仅支持 `proxyConfig` 字段占位）
- 设置页已支持开机自启动（`app.setLoginItemSettings`），开发环境未打包时会报系统权限错误（仅噪音，不影响功能）
- 低频巡检探针仅验证中控台页面可达性（导航 + body 就绪 + 标题记录，已改用真实 dashboard URL）；业务选择器覆盖随 c48 接入框架落地，其余功能待后续移植
- 巡检 / 清理暂无手动触发入口（巡检可通过开关即时生效，清理随启动和每日定时执行）