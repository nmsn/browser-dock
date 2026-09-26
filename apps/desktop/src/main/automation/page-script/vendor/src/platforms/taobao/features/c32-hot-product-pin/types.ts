/**
 * C32 爆品置顶 —— 页面侧共享类型与常量。
 * 自 freelive-browser-extension c32-hot-product-pin/types.ts 移植；
 * 消息传递相关类型（ExtensionMessage 等）在嵌入式架构下不存在，已剔除。
 */

/** 与直播计划页状态下拉选项一致 */
export const C32_LIVE_STATUS_OPTIONS = ['全部', '未开播', '直播中', '已开播'] as const;

export type C32LiveStatus = (typeof C32_LIVE_STATUS_OPTIONS)[number];

/** 仅直播中有「直播详情」，一条龙默认选直播中 */
export const C32_DEFAULT_LIVE_STATUS: C32LiveStatus = '直播中';

export type { DetailLiveStatusKind } from '../../../shared/dom/detail-live-status';

/** 单个商品的置顶结果（页面侧 pin-hot-product 产出） */
export type C32PinProductItem = {
  productId: string;
  success: boolean;
  cancelled?: boolean;
  pocketTabReady: boolean;
  productSearchModeSet: boolean;
  productSearchFilled: boolean;
  productFound: boolean;
  pinClicked: boolean;
  pinConfirmed: boolean;
  errorMessage?: string;
};
