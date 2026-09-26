/**
 * 淘宝直播「领取条件」级联选项树。
 * C48 树来自 2026-08-06 CDP 实页（market.m live-coupon）；
 * D89 在限观众行为叶子上保留「查看官网」（宠粉红包 RPA/实页）。
 */

export type ClaimConditionNode = {
  value: string;
  label: string;
  children?: ClaimConditionNode[];
};

export type ClaimConditionPath = string[];

const FAN_IDENTITY_CHILDREN: ClaimConditionNode[] = [
  { value: '铁粉及以上', label: '铁粉及以上' },
  { value: '钻粉及以上', label: '钻粉及以上' },
  { value: '挚爱及以上', label: '挚爱及以上' },
  { value: '超级粉及以上', label: '超级粉及以上' },
  { value: '星辰粉及以上', label: '星辰粉及以上' },
];

const WATCH_DURATION_CHILDREN: ClaimConditionNode[] = [
  { value: '满1分钟', label: '满1分钟' },
  { value: '满3分钟', label: '满3分钟' },
  { value: '满5分钟', label: '满5分钟' },
  { value: '满8分钟', label: '满8分钟' },
  { value: '满10分钟', label: '满10分钟' },
  { value: '满15分钟', label: '满15分钟' },
  { value: '满20分钟', label: '满20分钟' },
  { value: '满30分钟', label: '满30分钟' },
];

const LIKE_CHILDREN: ClaimConditionNode[] = [
  { value: '满20次', label: '满20次' },
  { value: '满50次', label: '满50次' },
  { value: '满100次', label: '满100次' },
];

/** C48 优惠券红包弹窗（CDP：.next-cascader-select-dropdown） */
export const C48_CLAIM_CONDITION_TREE: ClaimConditionNode[] = [
  { value: '不限', label: '不限' },
  {
    value: '限粉丝身份',
    label: '限粉丝身份',
    children: FAN_IDENTITY_CHILDREN,
  },
  {
    value: '限观众行为',
    label: '限观众行为',
    children: [
      { value: '添加桌面主播', label: '添加桌面主播' },
      {
        value: '观看时长',
        label: '观看时长',
        children: WATCH_DURATION_CHILDREN,
      },
      {
        value: '点赞',
        label: '点赞',
        children: LIKE_CHILDREN,
      },
      { value: '关注主播', label: '关注主播' },
      { value: '分享直播', label: '分享直播' },
      { value: '评论', label: '评论' },
      { value: '查看宝贝', label: '查看宝贝' },
    ],
  },
];

/** D89 宠粉红包：限观众行为含「查看官网」（与 C48 的 评论/查看宝贝 不同） */
export const D89_CLAIM_CONDITION_TREE: ClaimConditionNode[] = [
  { value: '不限', label: '不限' },
  {
    value: '限粉丝身份',
    label: '限粉丝身份',
    children: FAN_IDENTITY_CHILDREN,
  },
  {
    value: '限观众行为',
    label: '限观众行为',
    children: [
      { value: '添加桌面主播', label: '添加桌面主播' },
      {
        value: '观看时长',
        label: '观看时长',
        children: WATCH_DURATION_CHILDREN,
      },
      {
        value: '点赞',
        label: '点赞',
        children: LIKE_CHILDREN,
      },
      { value: '关注主播', label: '关注主播' },
      { value: '分享直播', label: '分享直播' },
      { value: '查看官网', label: '查看官网' },
    ],
  },
];

export const DEFAULT_CLAIM_CONDITION_PATH: ClaimConditionPath = ['不限'];

export function formatClaimConditionPath(path: ClaimConditionPath | undefined): string {
  return (path ?? []).map((part) => part.trim()).filter(Boolean).join(' / ');
}

export function normalizeClaimConditionPath(
  path: ClaimConditionPath | undefined,
): ClaimConditionPath {
  return (path ?? []).map((part) => part.trim()).filter(Boolean);
}

export function isUnlimitedClaimPath(path: ClaimConditionPath | undefined): boolean {
  const normalized = normalizeClaimConditionPath(path);
  return normalized.length === 1 && normalized[0] === '不限';
}

/** 校验路径是否落在给定选项树叶子上；合法返回 undefined */
export function validateClaimConditionPath(
  path: ClaimConditionPath | undefined,
  tree: ClaimConditionNode[],
): string | undefined {
  const normalized = normalizeClaimConditionPath(path);
  if (normalized.length === 0) return '领取条件不能为空';

  let nodes: ClaimConditionNode[] | undefined = tree;
  let current: ClaimConditionNode | undefined;
  for (const segment of normalized) {
    if (!nodes) return `领取条件路径无效：多余层级「${segment}」`;
    current = nodes.find((node) => node.value === segment);
    if (!current) return `领取条件无效：未找到「${segment}」`;
    nodes = current.children;
  }
  if (current?.children?.length) {
    return `领取条件未选完整：请继续选择「${current.label}」下的选项`;
  }
  return undefined;
}
