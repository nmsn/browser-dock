import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { join } from 'path'

/**
 * 运行时迁移（部署容器/发布流程用，替代 drizzle-kit）
 * 用法：DATABASE_URL=... node dist/db/migrate.js
 * migrationsFolder 相对本文件定位（dist/db → apps/server/drizzle），不依赖 cwd
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const client = postgres(url, { max: 1 })
  const db = drizzle(client)

  try {
    await migrate(db, { migrationsFolder: join(__dirname, '../../drizzle') })
    console.log('migrations applied')
  } catch (err) {
    console.error('migration failed:', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

void main()
