import { Injectable, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { Inject } from '@nestjs/common'
import { DrizzleClient, type DrizzleDB } from '../db/drizzle.module'
import { rooms } from '../db/schema'

@Injectable()
export class RoomsService {
  constructor(@Inject(DrizzleClient) private readonly db: DrizzleDB) {}

  list() {
    return this.db.select().from(rooms).orderBy(rooms.id)
  }

  async get(id: number) {
    const [room] = await this.db.select().from(rooms).where(eq(rooms.id, id)).limit(1)
    if (!room) throw new NotFoundException(`room ${id} not found`)
    return room
  }

  async create(input: { taobaoAccountId: string; roomName: string; note?: string }) {
    const [room] = await this.db
      .insert(rooms)
      .values({
        taobaoAccountId: input.taobaoAccountId,
        roomName: input.roomName,
        note: input.note ?? null
      })
      .returning()
    return room
  }

  async update(
    id: number,
    patch: { roomName?: string; note?: string | null; enabled?: boolean }
  ) {
    await this.get(id)
    const [room] = await this.db.update(rooms).set(patch).where(eq(rooms.id, id)).returning()
    return room
  }

  async remove(id: number): Promise<void> {
    await this.get(id)
    // 计划表引用房间：存在计划时拒绝删除（FK restrict）
    await this.db.delete(rooms).where(eq(rooms.id, id))
  }
}
