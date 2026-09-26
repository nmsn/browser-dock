import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import { DrizzleClient, type DrizzleDB } from '../db/drizzle.module'
import { planConfigs, plans, rooms, type Plan, type PlanConfig } from '../db/schema'
import { validateHotItemSlotIds } from '../common/domain-rules'

/**
 * 计划与任务配置的管理端服务（apps/server/README.md 第 6 节）
 * 状态流转只由 RPA 接口驱动；管理端仅创建/编辑/触发/重试/取消
 */

export interface CreatePlanInput {
  roomId: number
  liveDate: string
  startTime?: string
  endTime?: string
  liveTitle?: string
  planCode?: string
  scheduledTriggerTime?: string
}

export interface UpdatePlanInput {
  liveDate?: string
  startTime?: string | null
  endTime?: string | null
  liveTitle?: string | null
  planCode?: string | null
  scheduledTriggerTime?: string | null
}

const PLAN_TERMINAL_STATUSES = ['CREATED', 'CREATE_FAILED', 'CANCELLED']
const CONFIG_TERMINAL_STATUSES = ['DONE', 'FAILED', 'CANCELLED', 'CLOSED', 'CANCELLING']

@Injectable()
export class PlansService {
  constructor(@Inject(DrizzleClient) private readonly db: DrizzleDB) {}

  async list(date?: string, roomId?: number): Promise<Array<Plan & { configs: PlanConfig[] }>> {
    const roomRows = roomId
      ? await this.db.select().from(rooms).where(eq(rooms.id, roomId))
      : await this.db.select().from(rooms)
    const result: Array<Plan & { configs: PlanConfig[] }> = []
    for (const room of roomRows) {
      const roomPlans = await this.db
        .select()
        .from(plans)
        .where(eq(plans.roomId, room.id))
        .orderBy(desc(plans.id))
      for (const plan of roomPlans) {
        if (date && plan.liveDate !== date) continue
        const configs = await this.db
          .select()
          .from(planConfigs)
          .where(eq(planConfigs.planId, plan.id))
          .orderBy(desc(planConfigs.id))
        result.push({ ...plan, configs })
      }
    }
    return result
  }

  async get(id: number): Promise<Plan & { configs: PlanConfig[] }> {
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, id)).limit(1)
    if (!plan) throw new NotFoundException(`plan ${id} not found`)
    const configs = await this.db
      .select()
      .from(planConfigs)
      .where(eq(planConfigs.planId, id))
      .orderBy(desc(planConfigs.id))
    return { ...plan, configs }
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.liveDate)) {
      throw new BadRequestException('liveDate 必须为 yyyy-MM-dd')
    }
    const [room] = await this.db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1)
    if (!room) throw new NotFoundException(`room ${input.roomId} not found`)

    const [plan] = await this.db
      .insert(plans)
      .values({
        roomId: input.roomId,
        liveDate: input.liveDate,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        liveTitle: input.liveTitle ?? null,
        planCode: input.planCode ?? null,
        scheduledTriggerTime: parseDate(input.scheduledTriggerTime)
      })
      .returning()
    return plan
  }

  async update(id: number, patch: UpdatePlanInput): Promise<Plan> {
    const plan = await this.get(id)
    if (PLAN_TERMINAL_STATUSES.includes(plan.planStatus)) {
      throw new BadRequestException('计划已终态，不可编辑')
    }
    const [updated] = await this.db
      .update(plans)
      .set({
        ...(patch.liveDate !== undefined ? { liveDate: patch.liveDate } : {}),
        ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
        ...(patch.endTime !== undefined ? { endTime: patch.endTime } : {}),
        ...(patch.liveTitle !== undefined ? { liveTitle: patch.liveTitle } : {}),
        ...(patch.planCode !== undefined ? { planCode: patch.planCode } : {}),
        ...(patch.scheduledTriggerTime !== undefined
          ? { scheduledTriggerTime: parseDate(patch.scheduledTriggerTime) }
          : {})
      })
      .where(eq(plans.id, id))
      .returning()
    return updated
  }

  /** 管理端取消：置终态 CANCELLED（从 task/list 消失，客户端轮询感知） */
  async cancel(id: number): Promise<Plan> {
    const plan = await this.get(id)
    if (PLAN_TERMINAL_STATUSES.includes(plan.planStatus)) {
      throw new BadRequestException('计划已终态')
    }
    const [updated] = await this.db
      .update(plans)
      .set({ planStatus: 'CANCELLED' })
      .where(eq(plans.id, id))
      .returning()
    return updated
  }

  async remove(id: number): Promise<void> {
    await this.get(id)
    // plan_configs 外键 onDelete cascade：配置随计划级联删除
    await this.db.delete(plans).where(eq(plans.id, id))
  }

  // ── 任务配置 ────────────────────────────────────────────────

  async createConfig(
    planId: number,
    input: { configType: string; configData: unknown; scheduledTriggerTime?: string }
  ): Promise<PlanConfig> {
    await this.get(planId)
    if (input.configType !== 'HOT_ITEM_TOP') {
      throw new BadRequestException('阶段一仅支持 HOT_ITEM_TOP 任务配置')
    }
    const error = validateHotItemSlotIds(input.configData)
    if (error) throw new BadRequestException(error)

    const [config] = await this.db
      .insert(planConfigs)
      .values({
        planId,
        configType: 'HOT_ITEM_TOP',
        configData: input.configData as Record<string, unknown>,
        scheduledTriggerTime: parseDate(input.scheduledTriggerTime)
      })
      .returning()
    return config
  }

  async updateConfig(
    id: number,
    patch: { configData?: unknown; scheduledTriggerTime?: string | null }
  ): Promise<PlanConfig> {
    const config = await this.getConfig(id)
    if (CONFIG_TERMINAL_STATUSES.includes(config.configStatus)) {
      throw new BadRequestException('任务配置已终态，不可编辑')
    }
    if (patch.configData !== undefined) {
      const error = validateHotItemSlotIds(patch.configData)
      if (error) throw new BadRequestException(error)
    }
    const [updated] = await this.db
      .update(planConfigs)
      .set({
        ...(patch.configData !== undefined
          ? { configData: patch.configData as Record<string, unknown> }
          : {}),
        ...(patch.scheduledTriggerTime !== undefined
          ? { scheduledTriggerTime: parseDate(patch.scheduledTriggerTime) }
          : {})
      })
      .where(eq(planConfigs.id, id))
      .returning()
    return updated
  }

  /** 仅未认领/待执行配置可删 */
  async removeConfig(id: number): Promise<void> {
    const config = await this.getConfig(id)
    if (config.claimDeviceId || config.configStatus !== 'PENDING_PUSH') {
      throw new BadRequestException('任务已被认领或非待执行状态，不可删除')
    }
    await this.db.delete(planConfigs).where(eq(planConfigs.id, id))
  }

  /** 立即执行：scheduledTriggerTime = now */
  async triggerConfig(id: number): Promise<PlanConfig> {
    const config = await this.getConfig(id)
    if (CONFIG_TERMINAL_STATUSES.includes(config.configStatus)) {
      throw new BadRequestException('任务配置已终态，不可触发')
    }
    const [updated] = await this.db
      .update(planConfigs)
      .set({ scheduledTriggerTime: new Date() })
      .where(eq(planConfigs.id, id))
      .returning()
    return updated
  }

  /** 手动重置：PENDING_PUSH + retryCount 清零 */
  async retryConfig(id: number): Promise<PlanConfig> {
    const config = await this.getConfig(id)
    if (config.configStatus !== 'FAILED') {
      throw new BadRequestException('仅 FAILED 状态可手动重试')
    }
    const [updated] = await this.db
      .update(planConfigs)
      .set({ configStatus: 'PENDING_PUSH', retryCount: 0, claimDeviceId: null, claimTime: null })
      .where(eq(planConfigs.id, id))
      .returning()
    return updated
  }

  private async getConfig(id: number): Promise<PlanConfig> {
    const [config] = await this.db
      .select()
      .from(planConfigs)
      .where(eq(planConfigs.id, id))
      .limit(1)
    if (!config) throw new NotFoundException(`config ${id} not found`)
    return config
  }
}

function parseDate(value?: string | null): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`无效时间格式：${value}`)
  return date
}
