import { Module } from '@nestjs/common'
import { AdminModule } from './admin/admin.module'
import { AuthModule } from './auth/auth.module'
import { DrizzleModule } from './db/drizzle.module'
import { RpaModule } from './rpa/rpa.module'

/**
 * 根模块：Drizzle（全局）+ Auth（设备注册/管理端登录）+ Admin（管理 REST）+ Rpa（任务契约）
 */
@Module({
  imports: [DrizzleModule, AuthModule, AdminModule, RpaModule]
})
export class AppModule {}
