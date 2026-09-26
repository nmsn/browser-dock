import { getDatabase } from './database'
import type { Account, LoginStatus, ProxyConfig } from '../../shared/types'

/**
 * 账号 CRUD
 * @see 文档 2.5 accounts 表 / 6.4 Profile 管理要求
 */

interface AccountRow {
  id: string
  name: string
  taobao_username: string | null
  profile_path: string
  proxy_config: string | null
  notes: string | null
  created_at: string
  last_login_at: string | null
  login_status: LoginStatus
  last_login_check_at: string | null
}

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    taobaoUsername: row.taobao_username ?? '',
    profilePath: row.profile_path,
    proxyConfig: row.proxy_config ? (JSON.parse(row.proxy_config) as ProxyConfig) : undefined,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? undefined,
    loginStatus: row.login_status,
    lastLoginCheckAt: row.last_login_check_at ?? undefined
  }
}

export function listAccounts(): Account[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM accounts ORDER BY created_at DESC')
    .all() as AccountRow[]
  return rows.map(rowToAccount)
}

export function getAccount(id: string): Account | null {
  const row = getDatabase()
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .get(id) as AccountRow | undefined
  return row ? rowToAccount(row) : null
}

export function createAccount(account: Omit<Account, 'createdAt' | 'loginStatus'>): Account {
  const now = new Date().toISOString()
  const full: Account = { ...account, createdAt: now, loginStatus: 'unknown' }
  getDatabase()
    .prepare(
      `INSERT INTO accounts (id, name, taobao_username, profile_path, proxy_config, notes, created_at, login_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      full.id,
      full.name,
      full.taobaoUsername,
      full.profilePath,
      full.proxyConfig ? JSON.stringify(full.proxyConfig) : null,
      full.notes,
      full.createdAt,
      full.loginStatus
    )
  return full
}

export function updateAccount(id: string, patch: Partial<Account>): Account | null {
  const existing = getAccount(id)
  if (!existing) return null
  const merged = { ...existing, ...patch }
  getDatabase()
    .prepare(
      `UPDATE accounts SET
        name = ?, taobao_username = ?, profile_path = ?, proxy_config = ?,
        notes = ?, last_login_at = ?, login_status = ?, last_login_check_at = ?
       WHERE id = ?`
    )
    .run(
      merged.name,
      merged.taobaoUsername,
      merged.profilePath,
      merged.proxyConfig ? JSON.stringify(merged.proxyConfig) : null,
      merged.notes,
      merged.lastLoginAt ?? null,
      merged.loginStatus,
      merged.lastLoginCheckAt ?? null,
      id
    )
  return merged
}

export function deleteAccount(id: string): boolean {
  const result = getDatabase().prepare('DELETE FROM accounts WHERE id = ?').run(id)
  return result.changes > 0
}
