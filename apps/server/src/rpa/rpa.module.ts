import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { RecordsController } from './records.controller'
import { TaskController } from './task.controller'
import { TaskService } from './task.service'

/**
 * RPA 任务模块：list / claim / report / cancel + 执行记录上传
 * 认证走 AuthModule 的 DeviceGuard
 */
@Module({
  imports: [AuthModule],
  controllers: [TaskController, RecordsController],
  providers: [TaskService]
})
export class RpaModule {}
