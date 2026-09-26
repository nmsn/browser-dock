import type { CdpClient } from '../../chrome/cdp-client'
import type { NetworkCaptureService } from '../network-capture'
import type { FeatureField, FeatureInfo, PageAdapter, TaskLogger } from '../../../shared/types'

/**
 * 内置功能注册表
 * @see docs/c48-integration-plan.md Phase C / docs/adr/0001-embedded-electron-execution-host.md
 *
 * feature 任务由主进程编排执行（不经 vm 沙箱）：
 * - runtime 决定执行宿主与 ctx 形态：
 *   - 'embedded'（新基座）：嵌入式账号视图，ctx 提供 PageAdapter + window.open 捕获
 *   - 'external-chrome'（@deprecated 过渡期，仅 c48）：外部 Chrome + CDP
 * - run 返回结构化结果（步进标志），业务失败以 ok:false + detail 表达
 * - 页面异常直接抛出（PG_* / NETWORK_* 错误码），交由 executor 统一处理与诊断
 */

export type FeatureRuntime = 'embedded' | 'external-chrome'

/** 外部 Chrome 执行上下文（@deprecated 过渡期保留，仅 c48 使用） */
export interface ExternalFeatureContext {
  /** 页面主 target 客户端（已 connect；feature 自行 enableAutoAttach / 获取子会话） */
  cdp: CdpClient
  network: NetworkCaptureService
  logger: TaskLogger
  signal: AbortSignal
}

/** 嵌入式账号视图执行上下文（新基座） */
export interface EmbeddedFeatureContext {
  /** 账号视图页面适配器（ElectronPageAdapter） */
  page: PageAdapter
  /**
   * 等待 window.open 捕获的 URL（C32 列表页点「直播详情」后调用）；
   * 超时返回 null，调用方按 liveId 规则回退构造
   */
  waitForWindowOpenUrl: (timeoutMs?: number) => Promise<string | null>
  logger: TaskLogger
  signal: AbortSignal
}

export type FeatureContext = EmbeddedFeatureContext | ExternalFeatureContext

export type FeatureRunResult = {
  ok: boolean
  detail: string
  /** 分段步进标志，写入 ExecutionLog.result 供 UI 展示 */
  steps?: Record<string, boolean>
}

export interface TaobaoFeature {
  id: string
  label: string
  runtime: FeatureRuntime
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
