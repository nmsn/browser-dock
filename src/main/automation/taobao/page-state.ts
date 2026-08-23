/**
 * 淘宝页面类型判定（URL 规则，主进程版）
 * 移植自 freelive-browser-extension shared/page-state.ts（实页验证）
 */

export type TaobaoPageKind =
  | 'liveList'
  | 'liveDashboard'
  | 'livePreview'
  | 'liveDetail'
  | 'seckillPlay'
  | 'seckillPush'
  | 'unsupported'

export const TAOBAO_DASHBOARD_URL = 'https://liveplatform.taobao.com/restful/index/home/dashboard'

export function detectTaobaoPageKindFromUrl(href: string): TaobaoPageKind {
  try {
    const parsed = new URL(href)
    return detectPageKind(parsed.host, parsed.pathname, href)
  } catch {
    return 'unsupported'
  }
}

function detectPageKind(host: string, pathname: string, url: string): TaobaoPageKind {
  if (host === 'liveplatform.taobao.com') {
    if (pathname.includes('/restful/index/live/list')) return 'liveList'
    if (/preview|yugao|notice|trailer/i.test(`${pathname}${url}`)) return 'livePreview'
    if (pathname.includes('/restful/index/home/dashboard')) return 'liveDashboard'
    if (pathname.includes('/live/marketing/miaosha') || pathname.includes('/marketing/miaosha')) {
      return 'liveDashboard'
    }
    if (url.includes('detail') || url.includes('liveId') || url.includes('id=')) return 'liveDetail'
    return 'liveDashboard'
  }

  // 聚光秒杀互动页（常见为营销页 iframe，也可能被单独打开）
  if (host === 'mk.ju.taobao.com') {
    return 'seckillPlay'
  }

  // C46：直播详情「秒杀推送」弹窗内嵌 Rax 页
  if (host === 'market.m.taobao.com') {
    if (pathname.includes('app-live-seckill-push') || url.includes('seckill-push')) {
      return 'seckillPush'
    }
  }

  return 'unsupported'
}
