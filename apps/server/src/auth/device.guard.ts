import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { DeviceService } from './device.service'

/**
 * 设备认证 Guard（RPA 接口用）
 * Authorization: Bearer <deviceToken> → 解析并挂载 req.deviceId
 * 请求体中的 deviceId 字段与 token 不一致由各接口自行校验（403）
 */
export interface DeviceRequest extends Request {
  deviceId?: string
}

@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly deviceService: DeviceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>()
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    if (!token) return false

    const device = await this.deviceService.resolveByToken(token)
    if (!device) return false

    request.deviceId = device.id
    return true
  }
}
