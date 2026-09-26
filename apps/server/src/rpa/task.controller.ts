import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { DeviceGuard, type DeviceRequest } from '../auth/device.guard'
import { TaskService } from './task.service'
import { TaskCancelDto, TaskClaimDto, TaskListDto, TaskReportDto } from './dto/task.dto'

/**
 * RPA 任务四接口（设备认证）
 * 语义要点见 apps/server/README.md 第 4 节；transport 采用标准 HTTP 语义
 * （原插件信封不保留——消费方只有 browser-dock 桌面端，ADR-0003）
 */
@ApiTags('rpa/tasks')
@ApiBearerAuth('device')
@UseGuards(DeviceGuard)
@Controller('rpa/task')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post('list')
  @ApiOperation({ summary: '按淘宝账号拉取当天（含跨天未关闭）可执行计划' })
  list(@Body() dto: TaskListDto) {
    return this.taskService.list(dto)
  }

  @Post('claim')
  @ApiOperation({ summary: '批量认领（行级 CAS，同 deviceId 重领=自愈）' })
  claim(@Body() dto: TaskClaimDto, request: DeviceRequest) {
    return this.taskService.claim(dto, request.deviceId!)
  }

  @Post('report')
  @ApiOperation({ summary: '状态回写（终态 CAS；HOT_ITEM_TOP 失败自动重试 ≤3）' })
  report(@Body() dto: TaskReportDto, request: DeviceRequest) {
    return this.taskService.report(dto, request.deviceId!)
  }

  @Post('cancel')
  @ApiOperation({ summary: '显式取消回执（幂等，仅限本设备持有/未认领任务）' })
  cancel(@Body() dto: TaskCancelDto, request: DeviceRequest) {
    return this.taskService.cancel(dto, request.deviceId!)
  }
}
