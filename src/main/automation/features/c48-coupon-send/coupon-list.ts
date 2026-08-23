/**
 * C48 优惠券选券列表行抽取（主进程版）
 * 移植自 freelive-browser-extension coupon-list-capture.ts extractCouponRows
 *
 * 实页结构（userBenefitList.do 响应）：templateId 不在顶层字段，
 * 而是嵌在 `feature` 分号串里（…;templateId:8152947823;…）；行名取 couponName。
 */

export interface CapturedCouponRow {
  templateId: string
  name?: string
  order: number
}

export function extractCouponRows(value: unknown): CapturedCouponRow[] {
  const rows: CapturedCouponRow[] = []
  const seen = new Set<unknown>()
  let cursor = 0

  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return
    if (typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }

    const record = node as Record<string, unknown>
    const name = pickRowName(record)
    const featureTemplateId = extractFeatureTemplateId(record.feature)
    const topId = toIdString(record.templateId ?? record.template_id ?? record.cloudTemplateId)

    const templateId = featureTemplateId ?? topId
    if (templateId != null) {
      rows.push({ templateId, name, order: cursor })
      cursor += 1
    }

    for (const key of Object.keys(record)) visit(record[key])
  }

  visit(value)
  return rows
}

function toIdString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** 解析 feature 分号串里的 `templateId:<值>`；feature 形如 key:v;key:v;… */
function extractFeatureTemplateId(feature: unknown): string | undefined {
  if (typeof feature !== 'string' || !feature) return undefined
  for (const segment of feature.split(';')) {
    const idx = segment.indexOf(':')
    if (idx <= 0) continue
    if (segment.slice(0, idx).trim() !== 'templateId') continue
    const value = segment.slice(idx + 1).trim()
    return value || undefined
  }
  return undefined
}

const NAME_KEYS = [
  'couponName',
  'showBenefitName',
  'benefitName',
  'templateName',
  'name',
  'title'
]

function pickRowName(record: Record<string, unknown>): string | undefined {
  for (const key of NAME_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}
