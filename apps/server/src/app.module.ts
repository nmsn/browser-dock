import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module'
import { DrizzleModule } from './db/drizzle.module'

/**
 * 根模块：Drizzle（全局）+ Auth（设备注册/管理端登录）
 * admin / rpa 业务模块见各子模块（里程碑②实施顺序：apps/server/README.md 第 7 节）
 */
@Module({
  imports: [DrizzleModule, AuthModule]
})
export class AppModule {}
