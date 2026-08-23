/**
 * 淘宝直播详情（中控台）URL 规则
 * 移植自 freelive-browser-extension shared/live-detail-url.ts（实页验证）
 */

export const LIVE_DETAIL_URL_PREFIX =
  'https://liveplatform.taobao.com/restful/index/live/control?liveId='

export function extractLiveIdFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    const fromQuery =
      parsed.searchParams.get('liveId')?.trim() || parsed.searchParams.get('id')?.trim()
    if (fromQuery && /^\d{6,}$/.test(fromQuery)) {
      return fromQuery
    }
  } catch {
    // fall through to regex
  }
  const match = url.match(/[?&#]liveId=(\d{6,})/i)
  return match?.[1]
}

export function isLiveDetailUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.host !== 'liveplatform.taobao.com') return false
    if (parsed.pathname.includes('/live/control')) {
      return Boolean(extractLiveIdFromUrl(url))
    }
    return (
      (url.includes('liveId=') || /\/detail/i.test(parsed.pathname)) &&
      Boolean(extractLiveIdFromUrl(url))
    )
  } catch {
    return /liveplatform\.taobao\.com/i.test(url) && Boolean(extractLiveIdFromUrl(url))
  }
}

export function buildLiveDetailUrl(liveRoomId: string): string | undefined {
  const id = liveRoomId.replace(/\D/g, '')
  if (id.length < 6) return undefined
  return `${LIVE_DETAIL_URL_PREFIX}${id}`
}
