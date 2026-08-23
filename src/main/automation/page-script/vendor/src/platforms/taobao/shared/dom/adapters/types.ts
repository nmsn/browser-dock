/**
 * 表单控件适配器公共类型。
 * 新增适配器时尽量实现 FieldControlAdapter，便于 form-options 统一分发。
 */

export type AdapterKind =
  | 'text'
  | 'select'
  | 'cascader'
  | 'checkbox'
  | 'datepicker'
  | 'upload'
  | 'unknown';

export type FieldControlAdapter = {
  kind: AdapterKind;
  /** 字段容器内是否可识别为本控件 */
  match: (scope: ParentNode) => boolean;
  /** 回读当前业务展示值 */
  read: (scope: ParentNode) => string;
  /**
   * 写入期望值。
   * - select/checkbox：option 文案或「true」/「false」
   * - cascader：可用「a / b / c」路径串；多级优选 writePath
   * - text/datepicker：目标字符串
   */
  write: (scope: ParentNode, value: string) => Promise<boolean>;
  /** 级联路径写入（可选） */
  writePath?: (scope: ParentNode, path: string[]) => Promise<boolean>;
};
