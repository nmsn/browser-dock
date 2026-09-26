import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { DrizzleClient, type DrizzleDB } from '../db/drizzle.module'
import {
  planConfigs,
  plans,
  rooms,
  type Plan,
  type PlanConfig
} from '../db/schema'
import { AUTO_RETRY_CONFIG_TYPES, shanghaiToday, truncate500 } from '../common/domain-rules'
import type { TaskClaimDto, TaskListDto, TaskReportDto } from './dto/task.dto'

/**
 * RPA 任务四接口（apps/server/README.md 第 4 节）
 * 语义基线：扩展 docs/rpa-app-docs/12-场控自动化插件接口.md
 * - claim：行级 CAS（状态可认领 且 未被他设备持有）；同 deviceId 重领 = 自愈
 * - report：终态 CAS（迟到写回忽略 + 记日志）；EXECUTING 仅当前持有设备；
 *   LIVE_PLAN DONE 必带 liveId；HOT_ITEM_TOP FAILED 自动重置 PENDING_PUSH（retryCount < 3）
 * - 取消感知：无推送，客户端轮询；本接口仅作客户端显式取消的回执
 */

const PLAN_TERMINAL: Plan['planStatus'][] = ['CREATED', 'CREATE_FAILED', 'CANCELLED']
const CONFIG_TERMINAL: PlanConfig['configStatus'][] = ['DONE', 'FAILED', 'CANCELLED', 'CLOSED', 'CANCELLING']

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name)

  constructor(@Inject(DrizzleClient) private readonly db: DrizzleDB) {}

  // ── task/list ───────────────────────────────────────────────

  async list(dto: TaskListDto) {
    const [room] = await this.db
      .select()
      .from(rooms)
      .where(eq(rooms.taobaoAccountId, dto.taobaoAccount))
      .limit(1)
    if (!room || !room.enabled) {
      throw new NotFoundException('该淘宝账号未绑定直播间或已停用')
    }

    const liveDate = dto.liveDate ?? shanghaiToday()
    const statusFilter = dto.planStatuses?.length
      ? inArray(plans.planStatus, dto.planStatuses as Plan['planStatus'][])
      : undefined

    const roomPlans = await this.db
      .select()
      .from(plans)
      .where(
        and(
          eq(plans.roomId, room.id),
          eq(plans.executionMode, 'PLUGIN'),
          isNotNull(plans.scheduledTriggerTime),
          // 跨天未关闭：非终态计划随当天玩法一并返回（对齐原后端 2026-09-24 行为）
          or(eq(plans.liveDate, liveDate), inArray(plans.planStatus, ['PENDING_CREATE', 'CREATING'])),
          statusFilter
        )
      )

    const visiblePlans = roomPlans.filter((plan) => plan.scheduledTriggerTime !== null)

    const result = []
    for (const plan of visiblePlans) {
      const configs = await this.db
        .select()
        .from(planConfigs)
        .where(eq(planConfigs.planId, plan.id))
      result.push({
        roomId: room.id,
        roomName: room.roomName,
        liveDate: plan.liveDate,
        updateTime: plan.updatedAt.toISOString(),
        plans: [
          {
            id: plan.id,
            planCode: plan.planCode,
            roomId: room.id,
            roomName: room.roomName,
            executionMode: plan.executionMode,
            liveDate: plan.liveDate,
            startTime: plan.startTime,
            endTime: plan.endTime,
            liveId: plan.liveId,
            liveTitle: plan.liveTitle,
            planStatus: plan.planStatus,
            scheduledTriggerTime: plan.scheduledTriggerTime?.toISOString() ?? null,
            actualTriggerTime: plan.actualTriggerTime?.toISOString() ?? null,
            executionResult: plan.executionResult,
            claimDevice: plan.claimDeviceId,
            claimTime: plan.claimTime?.toISOString() ?? null,
            createTime: plan.createdAt.toISOString(),
            configList: configs.map((config) => this.toConfigItem(config))
          }
        ]
      })
    }
    return result
  }

  private toConfigItem(config: PlanConfig) {
    return {
      id: config.id,
      planId: config.planId,
      configType: config.configType,
      configData: config.configData,
      configStatus: config.configStatus,
      // 契约对齐：不返回 pluginStatusCode，客户端按 configStatus=PENDING_PUSH 判定可认领
      retryCount: config.retryCount,
      scheduledTriggerTime: config.scheduledTriggerTime?.toISOString() ?? null,
      actualTriggerTime: config.actualTriggerTime?.toISOString() ?? null,
      executionResult: config.executionResult,
      returnTime: config.returnTime?.toISOString() ?? null,
      claimDevice: config.claimDeviceId,
      claimTime: config.claimTime?.toISOString() ?? null,
      createTime: config.createdAt.toISOString()
    }
  }

  // ── task/claim ──────────────────────────────────────────────

  async claim(dto: TaskClaimDto, tokenDeviceId: string) {
    if (dto.deviceId !== tokenDeviceId) {
      throw new ForbiddenException('deviceId 与设备凭证不一致')
    }

    const claimed: Array<{ taskType: string; taskId: number }> = []
    const rejected: Array<{ taskType: string; taskId: number; reason: string }> = []

    for (const ref of dto.tasks) {
      const outcome =
        ref.taskType === 'LIVE_PLAN'
          ? await this.claimPlan(ref.taskId, dto.taobaoAccount, tokenDeviceId, dto.pluginVersion)
          : await this.claimConfig(ref.taskId, dto.taobaoAccount, tokenDeviceId)
      if (outcome.ok) {
        claimed.push({ taskType: ref.taskType, taskId: ref.taskId })
      } else {
        rejected.push({ taskType: ref.taskType, taskId: ref.taskId, reason: outcome.reason })
      }
    }
    return { claimed, rejected }
  }

  private async assertRoomBound(taobaoAccount: string, roomId: number): Promise<void> {
    const [room] = await this.db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
    if (!room || room.taobaoAccountId !== taobaoAccount) {
      throw new NotFoundException('该淘宝账号未绑定直播间')
    }
  }

  private async claimPlan(
    taskId: number,
    taobaoAccount: string,
    deviceId: string,
    pluginVersion: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, taskId)).limit(1)
    if (!plan) return { ok: false, reason: '任务不存在' }
    await this.assertRoomBound(taobaoAccount, plan.roomId)
    if (plan.executionMode !== 'PLUGIN') return { ok: false, reason: '该任务不是插件执行方式' }
    if (plan.planStatus !== 'PENDING_CREATE') {
      return { ok: false, reason: '该任务不是待执行状态' }
    }

    // 行级 CAS：待认领（未持有或本人持有）才允许；同设备重领 = 自愈
    const updated = await this.db
      .update(plans)
      .set({ claimDeviceId: deviceId, claimTime: new Date(), pluginVersion })
      .where(
        and(
          eq(plans.id, taskId),
          eq(plans.planStatus, 'PENDING_CREATE'),
          or(isNull(plans.claimDeviceId), eq(plans.claimDeviceId, deviceId))
        )
      )
      .returning({ id: plans.id })
    if (updated.length === 0) {
      return { ok: false, reason: '已被其他设备认领' }
    }
    return { ok: true }
  }

  private async claimConfig(
    taskId: number,
    taobaoAccount: string,
    deviceId: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const [config] = await this.db
      .select()
      .from(planConfigs)
      .where(eq(planConfigs.id, taskId))
      .limit(1)
    if (!config) return { ok: false, reason: '任务不存在' }
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, config.planId)).limit(1)
    if (!plan) return { ok: false, reason: '任务不存在' }
    await this.assertRoomBound(taobaoAccount, plan.roomId)
    if (config.configStatus !== 'PENDING_PUSH') {
      return { ok: false, reason: '该任务不是待执行状态' }
    }

    const updated = await this.db
      .update(planConfigs)
      .set({ claimDeviceId: deviceId, claimTime: new Date() })
      .where(
        and(
          eq(planConfigs.id, taskId),
          eq(planConfigs.configStatus, 'PENDING_PUSH'),
          or(isNull(planConfigs.claimDeviceId), eq(planConfigs.claimDeviceId, deviceId))
        )
      )
      .returning({ id: planConfigs.id })
    if (updated.length === 0) {
      return { ok: false, reason: config.claimDeviceId === deviceId ? '任务不存在' : '已被其他设备认领' }
    }
    return { ok: true }
  }

  // ── task/report ─────────────────────────────────────────────

  async report(dto: TaskReportDto, tokenDeviceId: string) {
    if (dto.deviceId && dto.deviceId !== tokenDeviceId) {
      throw new ForbiddenException('deviceId 与设备凭证不一致')
    }
    const outcome =
      dto.taskType === 'LIVE_PLAN'
        ? await this.reportPlan(dto, tokenDeviceId)
        : await this.reportConfig(dto, tokenDeviceId)
    return { accepted: outcome }
  }

  private async reportPlan(dto: TaskReportDto, deviceId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [plan] = await tx.select().from(plans).where(eq(plans.id, dto.taskId)).limit(1).for('update')
      if (!plan) throw new NotFoundException('任务不存在')
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, plan.roomId)).limit(1)
      if (!room || room.taobaoAccountId !== dto.taobaoAccount) {
        throw new NotFoundException('该淘宝账号未绑定直播间')
      }

      // 终态 CAS：迟到写回忽略 + 记日志
      if (PLAN_TERMINAL.includes(plan.planStatus)) {
        this.logger.warn(
          `late report ignored: plan ${plan.id} already ${plan.planStatus} (report ${dto.status} from ${deviceId})`
        )
        return false
      }
      // EXECUTING 仅当前持有设备
      if (dto.status === 'EXECUTING' && plan.claimDeviceId !== deviceId) {
        throw new ForbiddenException('任务已被其他设备认领')
      }

      if (dto.status === 'DONE') {
        if (!dto.liveId) {
          throw new ForbiddenException('创建直播ID 成功时必须回传场次ID')
        }
        await tx
          .update(plans)
          .set({
            planStatus: 'CREATED',
            liveId: dto.liveId,
            actualTriggerTime: parseDateOrNull(dto.actualTriggerTime) ?? new Date(),
            executionResult: truncate500(dto.executionResult),
            pluginVersion: dto.pluginVersion ?? plan.pluginVersion,
            updatedAt: new Date()
          })
          .where(eq(plans.id, plan.id))
        return true
      }

      await tx
        .update(plans)
        .set({
          ...(dto.status === 'FAILED' ? { planStatus: 'CREATE_FAILED' as const } : {}),
          ...(dto.status === 'CANCELLED' ? { planStatus: 'CANCELLED' as const } : {}),
          actualTriggerTime: parseDateOrNull(dto.actualTriggerTime) ?? plan.actualTriggerTime,
          executionResult: truncate500(dto.executionResult) ?? plan.executionResult,
          pluginVersion: dto.pluginVersion ?? plan.pluginVersion,
          updatedAt: new Date()
        })
        .where(eq(plans.id, plan.id))
      return true
    })
  }

  private async reportConfig(dto: TaskReportDto, deviceId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [config] = await tx
        .select()
        .from(planConfigs)
        .where(eq(planConfigs.id, dto.taskId))
        .limit(1)
        .for('update')
      if (!config) throw new NotFoundException('任务不存在')
      const [plan] = await tx.select().from(plans).where(eq(plans.id, config.planId)).limit(1)
      if (!plan) throw new NotFoundException('任务不存在')
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, plan.roomId)).limit(1)
      if (!room || room.taobaoAccountId !== dto.taobaoAccount) {
        throw new NotFoundException('该淘宝账号未绑定直播间')
      }

      if (CONFIG_TERMINAL.includes(config.configStatus)) {
        this.logger.warn(
          `late report ignored: config ${config.id} already ${config.configStatus} (report ${dto.status} from ${deviceId})`
        )
        return false
      }
      if (dto.status === 'EXECUTING' && config.claimDeviceId !== deviceId) {
        throw new ForbiddenException('任务已被其他设备认领')
      }

      const now = new Date()
      if (dto.status === 'EXECUTING') {
        await tx
          .update(planConfigs)
          .set({
            configStatus: 'EXECUTING',
            actualTriggerTime: parseDateOrNull(dto.actualTriggerTime) ?? now,
            updatedAt: now
          })
          .where(eq(planConfigs.id, config.id))
        return true
      }

      if (dto.status === 'DONE') {
        await tx
          .update(planConfigs)
          .set({
            configStatus: 'DONE',
            executionResult: truncate500(dto.executionResult),
            returnTime: parseDateOrNull(dto.finishTime) ?? now,
            updatedAt: now
          })
          .where(eq(planConfigs.id, config.id))
        return true
      }

      if (dto.status === 'CANCELLED') {
        await tx
          .update(planConfigs)
          .set({ configStatus: 'CANCELLED', failReason: truncate500(dto.failReason), returnTime: now, updatedAt: now })
          .where(eq(planConfigs.id, config.id))
        return true
      }

      // FAILED：自动重试集合内且未耗尽 → 重置 PENDING_PUSH（客户端下一轮 list 认领）
      const retryable =
        AUTO_RETRY_CONFIG_TYPES.has(config.configType) && config.retryCount < 3
      if (retryable) {
        await tx
          .update(planConfigs)
          .set({
            configStatus: 'PENDING_PUSH',
            retryCount: config.retryCount + 1,
            claimDeviceId: null,
            claimTime: null,
            failReason: truncate500(dto.failReason),
            updatedAt: now
          })
          .where(eq(planConfigs.id, config.id))
        this.logger.log(
          `config ${config.id} FAILED -> reset PENDING_PUSH (retry ${config.retryCount + 1}/3)`
        )
        return true
      }

      await tx
        .update(planConfigs)
        .set({
          configStatus: 'FAILED',
          failReason: truncate500(dto.failReason),
          returnTime: now,
          updatedAt: now
        })
        .where(eq(planConfigs.id, config.id))
      return true
    })
  }

  // ── task/cancel（客户端显式取消的回执；幂等）────────────────

  async cancel(dto: { taobaoAccount: string; taskType: 'LIVE_PLAN' | 'LIVE_PLAN_CONFIG'; taskId: number }, deviceId: string) {
    if (dto.taskType === 'LIVE_PLAN') {
      const [plan] = await this.db.select().from(plans).where(eq(plans.id, dto.taskId)).limit(1)
      if (!plan) throw new NotFoundException('任务不存在')
      await this.assertRoomBound(dto.taobaoAccount, plan.roomId)
      if (PLAN_TERMINAL.includes(plan.planStatus)) return { accepted: true }
      if (plan.claimDeviceId && plan.claimDeviceId !== deviceId) {
        throw new ForbiddenException('任务已被其他设备认领')
      }
      await this.db
        .update(plans)
        .set({ planStatus: 'CANCELLED', updatedAt: new Date() })
        .where(eq(plans.id, plan.id))
      return { accepted: true }
    }

    const [config] = await this.db.select().from(planConfigs).where(eq(planConfigs.id, dto.taskId)).limit(1)
    if (!config) throw new NotFoundException('任务不存在')
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, config.planId)).limit(1)
    if (!plan) throw new NotFoundException('任务不存在')
    await this.assertRoomBound(dto.taobaoAccount, plan.roomId)
    if (CONFIG_TERMINAL.includes(config.configStatus)) return { accepted: true }
    if (config.claimDeviceId && config.claimDeviceId !== deviceId) {
      throw new ForbiddenException('任务已被其他设备认领')
    }
    await this.db
      .update(planConfigs)
      .set({ configStatus: 'CANCELLED', returnTime: new Date(), updatedAt: new Date() })
      .where(eq(planConfigs.id, config.id))
    return { accepted: true }
  }
}

function parseDateOrNull(value?: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
