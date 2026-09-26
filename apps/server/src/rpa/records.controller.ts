import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsString } from 'class-validator'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Inject } from '@nestjs/common'
import { DeviceGuard, type DeviceRequest } from '../auth/device.guard'
import { loadEnv } from '../config/env'
import { DrizzleClient, type DrizzleDB } from '../db/drizzle.module'
import { executionRecords } from '../db/schema'

class ExecutionRecordBodyDto {
  /** JSON 字符串：{ taobaoAccountId, planId?, configId?, configType?, status, failReason?, result? } */
  @IsString()
  record!: string
}

const RECORD_STATUSES = ['DONE', 'FAILED', 'CANCELLED']

/**
 * 执行记录上传（multipart/form-data，对齐扩展 report-execution-record）
 * - record：JSON 字符串（必填），含 taobaoAccountId/status 等全部字段
 * - failureScreenshot：失败截图（可选，≤5MB，超限拒绝）
 */
@ApiTags('rpa/execution-records')
@ApiBearerAuth('device')
@UseGuards(DeviceGuard)
@Controller('rpa/execution-records')
export class RecordsController {
  constructor(@Inject(DrizzleClient) private readonly db: DrizzleDB) {}

  @Post()
  @UseInterceptors(FileInterceptor('failureScreenshot', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiOperation({ summary: '上传执行记录（含可选失败截图 ≤5MB）' })
  async upload(
    @Body() dto: ExecutionRecordBodyDto,
    @UploadedFile() screenshot: Express.Multer.File | undefined,
    @Req() request: DeviceRequest
  ) {
    let parsed: {
      taobaoAccountId?: string
      planId?: number | string
      configId?: number | string
      configType?: string
      status?: string
      failReason?: string
      result?: unknown
    }
    try {
      parsed = JSON.parse(dto.record)
    } catch {
      throw new BadRequestException('record 必须为合法 JSON 字符串')
    }
    if (!parsed.taobaoAccountId || !parsed.status || !RECORD_STATUSES.includes(parsed.status)) {
      throw new BadRequestException('record.taobaoAccountId 与 record.status(DONE/FAILED/CANCELLED) 必填')
    }

    const env = loadEnv()
    let screenshotPath: string | null = null
    if (screenshot) {
      mkdirSync(env.uploadDir, { recursive: true })
      screenshotPath = join(env.uploadDir, `${Date.now()}-${screenshot.originalname}`)
      writeFileSync(screenshotPath, screenshot.buffer)
    }

    const [record] = await this.db
      .insert(executionRecords)
      .values({
        deviceId: request.deviceId!,
        taobaoAccountId: parsed.taobaoAccountId,
        planId: parsed.planId ? Number(parsed.planId) || null : null,
        configId: parsed.configId ? Number(parsed.configId) || null : null,
        configType: parsed.configType ?? null,
        status: parsed.status,
        result: (parsed.result as Record<string, unknown>) ?? null,
        failReason: parsed.failReason ?? null,
        screenshotPath
      })
      .returning({ id: executionRecords.id })

    return { id: record.id }
  }
}
