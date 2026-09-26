import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { loadEnv } from '../config/env'
import { AdminAuthController } from './admin-auth.controller'
import { AdminJwtGuard } from './admin-jwt.guard'
import { DeviceController } from './device.controller'
import { DeviceService } from './device.service'

/**
 * 认证模块：设备注册（RPA 主体）+ 管理端 JWT
 * DeviceGuard / AdminJwtGuard 由各业务模块按需引用（导出 guard + service）
 */
const env = loadEnv()

@Module({
  imports: [
    JwtModule.register({
      secret: env.jwtSecret
    })
  ],
  controllers: [DeviceController, AdminAuthController],
  providers: [DeviceService, AdminJwtGuard],
  exports: [DeviceService, AdminJwtGuard, JwtModule]
})
export class AuthModule {}
