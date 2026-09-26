import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query
} from '@nestjs/common'
import { UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from 'class-validator'
import { AdminJwtGuard } from '../auth/admin-jwt.guard'
import { PlansService } from './plans.service'

class CreatePlanDto {
  @IsInt()
  roomId!: number

  @IsString()
  @MinLength(8)
  liveDate!: string // yyyy-MM-dd

  @IsOptional()
  @IsString()
  startTime?: string

  @IsOptional()
  @IsString()
  endTime?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  liveTitle?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  planCode?: string

  @IsOptional()
  @IsDateString()
  scheduledTriggerTime?: string
}

class UpdatePlanDto {
  @IsOptional()
  @IsString()
  liveDate?: string

  @IsOptional()
  @IsString()
  startTime?: string

  @IsOptional()
  @IsString()
  endTime?: string

  @IsOptional()
  @IsString()
  liveTitle?: string

  @IsOptional()
  @IsString()
  planCode?: string

  @IsOptional()
  @IsDateString()
  scheduledTriggerTime?: string
}

class CreateConfigDto {
  @IsIn(['HOT_ITEM_TOP'])
  configType!: 'HOT_ITEM_TOP'

  @IsObject()
  configData!: Record<string, unknown>

  @IsOptional()
  @IsDateString()
  scheduledTriggerTime?: string
}

class UpdateConfigDto {
  @IsOptional()
  @IsObject()
  configData?: Record<string, unknown>

  @IsOptional()
  @IsDateString()
  scheduledTriggerTime?: string
}

class ListPlansQuery {
  @IsOptional()
  @IsString()
  date?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId?: number
}

/**
 * 计划与任务配置的管理端 REST（简化管理平台，阶段一无 Web 页面）
 */
@UseGuards(AdminJwtGuard)
@ApiTags('admin/plans')
@ApiBearerAuth('admin')
@Controller('admin')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get('plans')
  @ApiOperation({ summary: '计划列表（含任务配置）' })
  list(@Query() query: ListPlansQuery) {
    return this.plansService.list(query.date, query.roomId)
  }

  @Get('plans/:id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.plansService.get(id)
  }

  @Post('plans')
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto)
  }

  @Put('plans/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(id, dto)
  }

  @Post('plans/:id/cancel')
  @ApiOperation({ summary: '取消计划（置终态 CANCELLED，客户端轮询感知）' })
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.plansService.cancel(id)
  }

  @Delete('plans/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.plansService.remove(id)
  }

  @Post('plans/:id/configs')
  @ApiOperation({ summary: '创建任务配置（HOT_ITEM_TOP，校验 hotItemSlotIds ≤3）' })
  createConfig(@Param('id', ParseIntPipe) planId: number, @Body() dto: CreateConfigDto) {
    return this.plansService.createConfig(planId, dto)
  }

  @Put('configs/:id')
  updateConfig(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateConfigDto) {
    return this.plansService.updateConfig(id, dto)
  }

  @Delete('configs/:id')
  removeConfig(@Param('id', ParseIntPipe) id: number) {
    return this.plansService.removeConfig(id)
  }

  @Post('configs/:id/trigger')
  @ApiOperation({ summary: '立即执行：scheduledTriggerTime = now' })
  triggerConfig(@Param('id', ParseIntPipe) id: number) {
    return this.plansService.triggerConfig(id)
  }

  @Post('configs/:id/retry')
  @ApiOperation({ summary: '手动重试：重置 PENDING_PUSH，retryCount 清零' })
  retryConfig(@Param('id', ParseIntPipe) id: number) {
    return this.plansService.retryConfig(id)
  }
}
