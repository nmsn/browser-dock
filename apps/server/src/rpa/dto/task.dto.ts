import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from 'class-validator'

/** 与扩展 contract.ts 逐字对齐的请求 DTO */

export class TaskListDto {
  @ApiProperty({ description: '淘宝数字用户ID（userNumId）' })
  @IsString()
  @MinLength(6)
  taobaoAccount!: string

  @ApiProperty({ description: '场次日期 yyyy-MM-dd，为空取北京时区当天', required: false })
  @IsOptional()
  @IsString()
  liveDate?: string

  @ApiProperty({ description: '计划状态过滤', required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  planStatuses?: string[]
}

export class ClaimTaskRefDto {
  @IsIn(['LIVE_PLAN', 'LIVE_PLAN_CONFIG'])
  taskType!: 'LIVE_PLAN' | 'LIVE_PLAN_CONFIG'

  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskId!: number
}

export class TaskClaimDto {
  @IsString()
  @MinLength(6)
  taobaoAccount!: string

  @IsString()
  @MinLength(8)
  deviceId!: string

  @IsString()
  pluginVersion!: string

  @ApiProperty({ type: [ClaimTaskRefDto], maxItems: 30 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ClaimTaskRefDto)
  tasks!: ClaimTaskRefDto[]
}

export class TaskReportDto {
  @IsString()
  @MinLength(6)
  taobaoAccount!: string

  @IsIn(['LIVE_PLAN', 'LIVE_PLAN_CONFIG'])
  taskType!: 'LIVE_PLAN' | 'LIVE_PLAN_CONFIG'

  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskId!: number

  @IsIn(['EXECUTING', 'DONE', 'FAILED', 'CANCELLED'])
  status!: 'EXECUTING' | 'DONE' | 'FAILED' | 'CANCELLED'

  @IsOptional()
  @IsDateString()
  actualTriggerTime?: string

  @IsOptional()
  @IsDateString()
  finishTime?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  failReason?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  executionResult?: string

  @ApiProperty({ description: 'LIVE_PLAN 报 DONE 时必传', required: false })
  @IsOptional()
  @IsString()
  liveId?: string

  @IsOptional()
  @IsString()
  pluginVersion?: string

  @IsOptional()
  @IsString()
  deviceId?: string
}

export class TaskCancelDto {
  @IsString()
  @MinLength(6)
  taobaoAccount!: string

  @IsIn(['LIVE_PLAN', 'LIVE_PLAN_CONFIG'])
  taskType!: 'LIVE_PLAN' | 'LIVE_PLAN_CONFIG'

  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskId!: number

  @IsOptional()
  @IsString()
  deviceId?: string
}
