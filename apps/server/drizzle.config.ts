import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit 配置
 * - generate 不需要数据库连接（schema → SQL）
 * - migrate 需要 DATABASE_URL；本地默认指向 docker-compose 起的 postgres
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://postgres:postgres@localhost:5432/browser_dock'
  }
})
