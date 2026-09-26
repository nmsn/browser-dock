import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common'
import { UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { desc, eq } from 'drizzle-orm'
import { Inject } from '@nestjs/common'
import { AdminJwtGuard } from '../auth/admin-jwt.guard'
import { DrizzleClient, type DrizzleDB } from '../db/drizzle.module'
import { executionRecords } from '../db/schema'

class ListRecordsQuery {
  @IsOptional()
  @IsString()
  deviceId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  configId?: number

  @IsOptional()
  @IsArray()
  @IsIn(['DONE', 'FAILED', 'CANCELLED'], { each: true })
  status?: string[]

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50
}

/** 执行记录查询（看板数据源；上传入口在 RPA 侧） */
@UseGuards(AdminJwtGuard)
@ApiTags('admin/records')
@ApiBearerAuth('admin')
@Controller('admin/records')
export class RecordsController {
  constructor(@Inject(DrizzleClient) private readonly db: DrizzleDB) {}

  @Get()
  @ApiOperation({ summary: '执行记录列表（按时间倒序）' })
  async list(@Query() query: ListRecordsQuery) {
    const conditions = []
    if (query.deviceId) conditions.push(eq(executionRecords.deviceId, query.deviceId))
    if (query.configId) conditions.push(eq(executionRecords.configId, query.configId))
    if (query.status && query.status.length > 0) {
      conditions.push(eq(executionRecords.status, query.status[0]))
    }

    let base = this.db.select().from(executionRecords).$dynamic()
    for (const condition of conditions) base = base.where(condition)
    return base.orderBy(desc(executionRecords.id)).limit(query.limit)
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const [record] = await this.db
      .select()
      .from(executionRecords)
      .where(eq(executionRecords.id, id))
      .limit(1)
    return record ?? null
  }
}
