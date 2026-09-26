import {
  fillTextInput,
  normalizeVisibleText,
} from '../../../../shared/automation/dom-actions';
import {
  normalizeFillValue,
  runResilientFillCycle,
  type ResilientFillMatchMode,
  type ResilientFillOutcome,
} from '../../../../shared/automation/fill-resilience';
import { sleepMs } from '../../../../shared/automation/sleep';
import type { AutomationLogSink } from '../../../../shared/automation/wait';
import { delay, type DelayKey } from '../../../../shared/automation/delay';

/**
 * 带回读校验的表单填写（自 freelive-browser-extension verified-inputs.ts 移植）。
 * browser-dock 仅保留 C32 依赖的文本填写路径；日期/数字/上传路径暂不移植。
 */

export type VerifyOkResult = {
  ok: true;
  expected: string;
  actual: string;
  attempts: number;
};

export type VerifiedInputOptions = {
  /** 用于错误信息，如「直播标题」 */
  label: string;
  /** 额外重试次数（不含首次），默认 2 */
  retries?: number;
  /** 填写/选择后等待 DOM 回读的 delay 档位，默认 short */
  delayKey?: DelayKey;
};

function truncateForInput(element: HTMLInputElement | HTMLTextAreaElement, value: string): string {
  const maxLength = element.maxLength > 0 ? element.maxLength : undefined;
  return maxLength ? Array.from(value).slice(0, maxLength).join('') : value;
}

function failVerified(label: string, expected: string, actual: string, attempts: number): never {
  throw new Error(
    `字段「${label}」填写后校验失败（尝试 ${attempts} 次）：期望「${expected}」，实际「${actual}」`,
  );
}

/**
 * 文本输入：写入 → 回读 value → 失败重试 → 仍失败 throw。
 */
export async function fillAndVerifyText(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  options: VerifiedInputOptions,
): Promise<VerifyOkResult> {
  const expected = truncateForInput(element, value.trim());
  const retries = options.retries ?? 2;
  const delayKey = options.delayKey ?? 'short';
  let actual = '';
  let attempts = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    attempts = attempt + 1;
    fillTextInput(element, expected);
    await delay(delayKey);
    actual = normalizeVisibleText(element.value);
    if (actual === expected) {
      return { ok: true, expected, actual, attempts };
    }
  }

  return failVerified(options.label, expected, actual, attempts);
}

export type FillAndVerifyTextResilientOptions = VerifiedInputOptions & {
  /** 每轮填写/回读前重定位「活」输入框；页面重渲染换节点后旧引用保值，回读会假通过 */
  relocate?: () => HTMLInputElement | HTMLTextAreaElement | undefined | null;
  /** 诊断日志通道（执行日志 warning，可含选择器/键值对），不进用户失败原因 */
  log?: AutomationLogSink;
  /** 回读比对方式：默认 exact；页面会对值做加工（加前后缀等）时用 includes */
  match?: ResilientFillMatchMode;
};

/**
 * 文本输入（抗重渲染版）：填写 → 首读校验 → 存活确认 → 失败重定位重填。
 * 针对扩展记录 107（受控组件在数据水合重渲染时把合成值回滚清空）：
 * 相比 fillAndVerifyText 的单次同节点回读，这里每轮重定位活节点、双次回读覆盖
 * 350–700ms 回滚窗，失败时经 log 发诊断后仍按家族约定 throw 用户语言错误。
 */
export async function fillAndVerifyTextResilient(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  options: FillAndVerifyTextResilientOptions,
): Promise<VerifyOkResult> {
  const expected = truncateForInput(element, value.trim());
  let nodeReplaced = false;

  const locate = (): HTMLInputElement | HTMLTextAreaElement => {
    const target = options.relocate?.() ?? element;
    if (target !== element) {
      nodeReplaced = true;
    }
    return target;
  };

  const outcome = await runResilientFillCycle(
    {
      fill: () => fillTextInput(locate(), expected),
      readback: () => locate()?.value ?? '',
      wait: sleepMs,
    },
    expected,
    { match: options.match, refills: options.retries },
  );

  if (!outcome.ok) {
    options.log?.(
      'warning',
      `${options.label}填写诊断：${describeFillMiss(locate(), expected, outcome, nodeReplaced)}`,
    );
    return failVerified(
      options.label,
      expected,
      normalizeFillValue(outcome.actual) || '(空)',
      outcome.attempts,
    );
  }

  return {
    ok: true,
    expected,
    actual: normalizeFillValue(outcome.actual),
    attempts: outcome.attempts,
  };
}

/** 填写未达标时的诊断键值对（走执行日志通道，不受用户文案限制）。 */
function describeFillMiss(
  target: HTMLInputElement | HTMLTextAreaElement | undefined,
  expected: string,
  outcome: ResilientFillOutcome,
  nodeReplaced: boolean,
): string {
  return [
    `尝试=${outcome.attempts}次`,
    `期望=${expected}`,
    `回读=[${outcome.observations.join(' | ') || '无'}]`,
    `节点更换=${nodeReplaced ? '是' : '否'}`,
    `节点在文档=${target?.isConnected ? '是' : '否'}`,
    `placeholder=${target?.placeholder ?? '(无元素)'}`,
  ].join(' · ');
}
