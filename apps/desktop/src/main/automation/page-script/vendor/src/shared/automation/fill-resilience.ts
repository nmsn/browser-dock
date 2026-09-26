/**
 * 表单填写抗重渲染竞态的纯逻辑核心（无 DOM / 无 wxt 依赖，供适配器与单测复用）。
 *
 * 2026-09-24 记录 107 实证（C32 商品 ID 搜索框）：fillTextInput 同步写值必然进 DOM，
 * 但页面受控组件可能未把合成值接进 state（或在数据水合重渲染时）把空值写回，
 * 350–700ms 内值即被清空。据此防护范式为「填后存活校验 + 自愈重填」：
 * 固定延时（如"填前等 1s"）是赌时点，校验回读是自证 + 自愈。
 * 每轮回读 ≥2 次（首读 + 存活确认），覆盖「校验跑在回滚前」的假通过；
 * 重填与回读的 DOM 定位由调用方注入（应重定位活节点，防旧游离节点假通过）。
 *
 * DOM 接线见 src/platforms/taobao/shared/dom/verified-inputs.ts 的
 * fillAndVerifyTextResilient；背景与防护范式见 docs/knowledge/13-表单填写与重渲染竞态.md。
 */

export type ResilientFillIo = {
  /** 执行一次填写（同步或异步） */
  fill: () => void | Promise<void>;
  /** 回读当前生效值（应读「活 DOM」上的节点，而非最初引用） */
  readback: () => string | Promise<string>;
  /** 等待（毫秒），单测注入假时钟 */
  wait: (ms: number) => Promise<void>;
};

export type ResilientFillMatchMode = 'exact' | 'includes';

export type ResilientFillOptions = {
  /** 回读比对方式：exact=去空白后全等（默认）；includes=去空白后包含（页面会对值做加工时用） */
  match?: ResilientFillMatchMode;
  /** 重填次数上限（不含首次），默认 2，总尝试 ≤3 */
  refills?: number;
  /** 重填前的等待毫秒，默认 500（给水合/重渲染让路） */
  refillDelayMs?: number;
  /** 通过后的额外存活确认次数，默认 1；0 关闭（仅首读） */
  survivalChecks?: number;
  /** 首读与各次存活确认的间隔毫秒，默认 400（覆盖记录 107 的 350–700ms 回滚窗） */
  survivalIntervalMs?: number;
};

export type ResilientFillOutcome = {
  ok: boolean;
  /** 最终一次回读值（原样，未归一化） */
  actual: string;
  /** 实际填写次数（1 + 重填次数） */
  attempts: number;
  /** 按时间顺序的全部回读值（诊断用） */
  observations: string[];
};

export const RESILIENT_FILL_DEFAULTS = {
  refills: 2,
  refillDelayMs: 500,
  survivalChecks: 1,
  survivalIntervalMs: 400,
} as const;

/** 归一化可见值：折叠空白并去首尾（与 normalizeVisibleText 同规则，此处零依赖复刻）。 */
export function normalizeFillValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** 回读值是否达到期望：两侧同规则归一化后全等 / 包含；期望为空时要求回读也为空。 */
export function fillReadbackMatches(
  actual: string,
  expected: string,
  match: ResilientFillMatchMode,
): boolean {
  const got = normalizeFillValue(actual);
  const want = normalizeFillValue(expected);
  if (!want) return got.length === 0;
  return match === 'includes' ? got.includes(want) : got === want;
}

/**
 * 抗回滚填写循环：填写 → 首读校验 → 存活确认，任一回读不达标即重填（重定位由
 * io.fill / io.readback 内部决定），重填耗尽仍失败则返回 ok=false（不抛错，由接线层裁定）。
 */
export async function runResilientFillCycle(
  io: ResilientFillIo,
  value: string,
  options?: ResilientFillOptions,
): Promise<ResilientFillOutcome> {
  const match = options?.match ?? 'exact';
  const refills = clampNonNegative(options?.refills ?? RESILIENT_FILL_DEFAULTS.refills);
  const refillDelayMs = clampNonNegative(
    options?.refillDelayMs ?? RESILIENT_FILL_DEFAULTS.refillDelayMs,
  );
  const survivalChecks = clampNonNegative(
    options?.survivalChecks ?? RESILIENT_FILL_DEFAULTS.survivalChecks,
  );
  const survivalIntervalMs = clampNonNegative(
    options?.survivalIntervalMs ?? RESILIENT_FILL_DEFAULTS.survivalIntervalMs,
  );

  const observations: string[] = [];
  let attempts = 0;
  let actual = '';

  for (let attempt = 0; attempt <= refills; attempt += 1) {
    attempts = attempt + 1;
    if (attempt > 0) {
      await io.wait(refillDelayMs);
    }
    await io.fill();

    let survived = true;
    // 首读 + 存活确认共用一个节奏：每次回读都计入 observations，任一不达标即进入重填
    for (let check = 0; check <= survivalChecks; check += 1) {
      await io.wait(survivalIntervalMs);
      actual = await io.readback();
      observations.push(actual);
      if (!fillReadbackMatches(actual, value, match)) {
        survived = false;
        break;
      }
    }
    if (survived) {
      return { ok: true, actual, attempts, observations };
    }
  }

  return { ok: false, actual, attempts, observations };
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
