import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { DeviceService } from './device.service'
import { RegisterDeviceDto } from './dto/register-device.dto'

/**
 * 设备注册（唯一不需要设备认证的 RPA 端点）
 * 同 deviceId 重复注册轮换 token；客户端收到 401 时自动重注册恢复
 */
@ApiTags('rpa/devices')
@Controller('rpa/devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post('register')
  @ApiOperation({ summary: '设备注册（首次签发 / 同 deviceId 轮换 token）' })
  async register(@Body() dto: RegisterDeviceDto): Promise<{ deviceToken: string }> {
    return this.deviceService.register(dto.deviceId, dto.name)
  }
}
