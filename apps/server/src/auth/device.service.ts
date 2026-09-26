import { createHash, randomBytes } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { Inject, Injectable } from '@nestjs/common'
import { DrizzleClient, type DrizzleDB } from '../db/drizzle.module'
import { devices } from '../db/schema'

/**
 * 设备注册与认证（apps/server/README.md 第 3 节）
 * - token 只在注册响应中出现一次，服务端仅存 sha256
 * - 同 deviceId 重复注册 = 轮换 token（旧 token 立即失效）
 */
@Injectable()
export class DeviceService {
  constructor(@Inject(DrizzleClient) private readonly db: DrizzleDB) {}

  async register(deviceId: string, name?: string): Promise<{ deviceToken: string }> {
    const deviceToken = randomBytes(32).toString('base64url')
    const tokenHash = sha256(deviceToken)

    await this.db
      .insert(devices)
      .values({ id: deviceId, tokenHash, name: name ?? null })
      .onConflictDoUpdate({
        target: devices.id,
        set: { tokenHash, name: name ?? null }
      })

    return { deviceToken }
  }

  /** 由 Bearer token 解析设备；无效返回 null */
  async resolveByToken(token: string): Promise<{ id: string } | null> {
    const tokenHash = sha256(token)
    const [device] = await this.db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.tokenHash, tokenHash))
      .limit(1)
    if (!device) return null
    await this.db
      .update(devices)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(devices.id, device.id)))
    return device
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
