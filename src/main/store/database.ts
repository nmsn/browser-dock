import Database from 'better-sqlite3'
import { DB_PATH } from '../config'
import logger from '../logger'
import { backupDatabase } from './backup'

/**
 * 数据库初始化与迁移
 * @see 文档 2.5 数据库设计 / 13.2 数据库迁移
 */

let db: Database.Database | null = null

/**
 * 获取数据库实例（单例）
 */
export function getDatabase(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }
  return db
}

/**
 * 初始化数据库：执行所有未应用的迁移
 */
export function initializeDatabase(): void {
  const database = getDatabase()
  ensureSchemaMigrationsTable(database)
  applyMigrations(database)
  logger.info('Database initialized')
}

/**
 * 确保 schema_migrations 表存在
 */
function ensureSchemaMigrationsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

/**
 * 获取已应用的迁移版本
 */
function getAppliedVersions(database: Database.Database): Set<number> {
  const rows = database.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  return new Set(rows.map((r) => r.version))
}

/**
 * 执行所有迁移
 */
function applyMigrations(database: Database.Database): void {
  const applied = getAppliedVersions(database)
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version)

  if (pending.length === 0) return

  // 13.2 迁移生成前先备份数据库，迁移失败可回滚
  try {
    backupDatabase('pre-migration')
  } catch (err) {
    // 备份失败不阻塞迁移（只记录警告）
    logger.warn({ err }, 'Database backup before migration failed')
  }

  const insertMigration = database.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
  )

  for (const migration of pending) {
    logger.info({ version: migration.version, name: migration.name }, 'Applying migration')
    const tx = database.transaction(() => {
      database.exec(migration.sql)
      insertMigration.run(migration.version, new Date().toISOString())
    })
    tx()
  }
}

/**
 * 迁移定义
 * 每个迁移包含 version（递增）、name（描述）、sql（DDL 语句）
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      -- 账号表
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        taobao_username TEXT,
        profile_path TEXT NOT NULL,
        proxy_config TEXT,
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
        config TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        timeout_ms INTEGER NOT NULL DEFAULT 120000,
        retry_policy TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );

      -- 调度规则表
      CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        account_ids TEXT NOT NULL,
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
        result TEXT,
        error TEXT,
        screenshots TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      -- 账号锁（同一账号同一时间只能有一个执行）
      CREATE TABLE account_locks (
        account_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      CREATE INDEX idx_execution_logs_schedule ON execution_logs(schedule_id);
      CREATE INDEX idx_execution_logs_account ON execution_logs(account_id);
      CREATE INDEX idx_execution_logs_task ON execution_logs(task_id);
      CREATE INDEX idx_execution_logs_status ON execution_logs(status);
      CREATE INDEX idx_schedules_enabled ON schedules(enabled);
    `
  },
  {
    version: 2,
    name: 'page_diagnostics',
    sql: `
      -- 页面诊断表（文档 11.2 页面变更检测）
      CREATE TABLE page_diagnostics (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        url TEXT,
        title TEXT,
        dom_snapshot_path TEXT,
        screenshot_path TEXT,
        console_errors TEXT,
        captured_at TEXT NOT NULL,
        FOREIGN KEY (execution_id) REFERENCES execution_logs(id)
      );
      CREATE INDEX idx_diagnostics_execution ON page_diagnostics(execution_id);
    `
  }
]

interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
