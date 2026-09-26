import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class RegisterDeviceDto {
  @ApiProperty({ description: '客户端生成的持久化 UUID' })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  deviceId!: string

  @ApiProperty({ description: '设备别名', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string
}
