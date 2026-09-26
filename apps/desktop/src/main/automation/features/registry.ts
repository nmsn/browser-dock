import type { CdpClient } from '../../chrome/cdp-client'
import type { NetworkCaptureService } from '../network-capture'
import type { FeatureField, FeatureInfo, TaskLogger } from '../../../shared/types'

/**
 * 内置功能注册表
 * @see docs/c48-integration-plan.md Phase C
 *
 * feature 任务由主进程编排执行（不经 vm 沙箱）：
 * - ctx 提供页面主会话客户端、网络捕获、任务日志与取消信号
 * - run 返回结构化结果（步进标志），业务失败以 ok:false + detail 表达
 * - 页面异常直接抛出（PG_* / NETWORK_* 错误码），交由 executor 统一处理与诊断
 */

export interface FeatureContext {
  /** 页面主 target 客户端（已 connect；feature 自行 enableAutoAttach / 获取子会话） */
  cdp: CdpClient
  network: NetworkCaptureService
  logger: TaskLogger
  signal: AbortSignal
}

export type FeatureRunResult = {
  ok: boolean
  detail: string
  /** 分段步进标志，写入 ExecutionLog.result 供 UI 展示 */
  steps?: Record<string, boolean>
}

export interface TaobaoFeature {
  id: string
  label: string
  fields: FeatureField[]
  run(ctx: FeatureContext, payload: Record<string, unknown>): Promise<FeatureRunResult>
}

const features = new Map<string, TaobaoFeature>()

export function registerFeature(feature: TaobaoFeature): void {
  if (features.has(feature.id)) {
    throw new Error(`Feature already registered: ${feature.id}`)
  }
  features.set(feature.id, feature)
}

export function getFeature(id: string): TaobaoFeature | null {
  return features.get(id) ?? null
}

export function listFeatures(): FeatureInfo[] {
  return Array.from(features.values()).map(({ id, label, fields }) => ({
    id,
    label,
    fields
  }))
}
