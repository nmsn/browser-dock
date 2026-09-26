import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PlansController } from './plans.controller'
import { PlansService } from './plans.service'
import { RecordsController } from './records.controller'
import { RoomsController } from './rooms.controller'
import { RoomsService } from './rooms.service'

/**
 * 简化管理 REST（阶段一纯 API，Swagger 即文档）
 * 全部挂 AdminJwtGuard（来自 AuthModule）
 */
@Module({
  imports: [AuthModule],
  controllers: [RoomsController, PlansController, RecordsController],
  providers: [RoomsService, PlansService]
})
export class AdminModule {}
