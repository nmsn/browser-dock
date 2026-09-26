/**
 * 内置功能注册入口
 * 新增功能时在此 import 其模块（副作用注册）
 */

import './c48-coupon-send'
import './c32-hot-product-pin'

export { getFeature, listFeatures, registerFeature } from './registry'
export type {
  EmbeddedFeatureContext,
  ExternalFeatureContext,
  FeatureContext,
  FeatureRuntime,
  FeatureRunResult,
  TaobaoFeature
} from './registry'
