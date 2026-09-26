import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { Global, Module } from '@nestjs/common'
import * as schema from './schema'

/**
 * DrizzleClient 全局 Provider（ADR-0003：drizzle-orm/postgres-js）
 * postgres-js 连接池参数：为后台轮询型负载准备小连接池即可
 */
export const DrizzleClient = Symbol('DrizzleClient')

export function createDrizzle(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, idle_timeout: 30 })
  return drizzle(client, { schema })
}

export type DrizzleDB = ReturnType<typeof createDrizzle>

@Global()
@Module({
  providers: [
    {
      provide: DrizzleClient,
      useFactory: (): DrizzleDB => {
        const url = process.env.DATABASE_URL
        if (!url) {
          throw new Error('DATABASE_URL is required')
        }
        return createDrizzle(url)
      }
    }
  ],
  exports: [DrizzleClient]
})
export class DrizzleModule {}
