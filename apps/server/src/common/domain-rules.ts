/**
 * HOT_ITEM_TOP configData 校验（与客户端 MappingError 同规则）
 * hotItemSlotIds：换行分隔的商品 ID，1–3 个、纯数字
 */
export const AUTO_RETRY_CONFIG_TYPES = new Set(['HOT_ITEM_TOP'])

export function validateHotItemSlotIds(configData: unknown): string | null {
  if (
    configData === null ||
    typeof configData !== 'object' ||
    typeof (configData as { hotItemSlotIds?: unknown }).hotItemSlotIds !== 'string'
  ) {
    return 'configData.hotItemSlotIds 必须为字符串（换行分隔的商品 ID）'
  }
  const ids = (configData as { hotItemSlotIds: string }).hotItemSlotIds
    .split(/\r?\n/)
    .map((id) => id.trim())
    .filter(Boolean)
  if (ids.length === 0) return 'hotItemSlotIds 不能为空'
  if (ids.length > 3) return 'hotItemSlotIds 最多 3 个商品 ID'
  for (const id of ids) {
    if (!/^\d{6,}$/.test(id)) return `商品 ID「${id}」格式无效（应为 6 位以上数字）`
  }
  return null
}

/** 北京时区的当天日期（task/list 的 liveDate 默认值） */
export function shanghaiToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 截断到 500 字（report 字段契约） */
export function truncate500(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length > 500 ? value.slice(0, 500) : value
}
