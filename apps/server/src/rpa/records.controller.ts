import { BadRequestException, Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DeviceGuard, type DeviceRequest } from '../auth/device.guard'
import { loadEnv } from '../config/env'
import { DrizzleClient, type DrizzleDB } from '../db/drizzle.module'
import { executionRecords } from '../db/schema'
import { Inject } from '@nestjs/common'

class ExecutionRecordDto {
  @IsString()
  taobaoAccountId!: string

  @IsOptional()
  @IsString()
  planId?: string

  @IsOptional()
  @IsString()
  configId?: string

  @IsOptional()
  @IsString()
  configType?: string

  @IsIn(['DONE', 'FAILED', 'CANCELLED'])
  status!: 'DONE' | 'FAILED' | 'CANCELLED'

  @IsOptional()
  @IsString()
  failReason?: string

  /** 结构化结果（steps 等），JSON 字符串 */
  @IsOptional()
  @IsString()
  result?: string
}

/**
 * 执行记录上传（multipart/form-data）
 * - record：JSON 字符串（必填）
 * - failureScreenshot：失败截图（可选，≤5MB，超限 400）
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
    @Body() dto: ExecutionRecordDto,
    @UploadedFile() screenshot: Express.Multer.File | undefined,
    request: DeviceRequest
  ) {
    let parsedResult: Record<string, unknown> | null = null
    if (dto.result) {
      try {
        parsedResult = JSON.parse(dto.result) as Record<string, unknown>
      } catch {
        throw new BadRequestException('result 必须为合法 JSON 字符串')
      }
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
        taobaoAccountId: dto.taobaoAccountId,
        planId: dto.planId ? Number(dto.planId) || null : null,
        configId: dto.configId ? Number(dto.configId) || null : null,
        configType: dto.configType ?? null,
        status: dto.status,
        result: parsedResult,
        failReason: dto.failReason ?? null,
        screenshotPath
      })
      .returning({ id: executionRecords.id })

    return { id: record.id }
  }
}
