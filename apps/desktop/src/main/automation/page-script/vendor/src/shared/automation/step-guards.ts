import { AutomationCancelledError, isAutomationCancelledError } from './execution-guard';

export class AutomationStateMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationStateMismatchError';
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new AutomationCancelledError();
  }
}

export async function assertElementPresent<T extends Element>(
  find: () => T | undefined,
  hint: string,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);

  const element = find();
  if (!element) {
    throw new AutomationStateMismatchError(`未找到目标元素：${hint}`);
  }

  return element;
}

export function isAutomationStateMismatchError(error: unknown): error is AutomationStateMismatchError {
  return error instanceof AutomationStateMismatchError;
}

export function getAutomationErrorMessage(error: unknown): string {
  if (isAutomationCancelledError(error)) {
    return '自动化已取消';
  }

  if (isAutomationStateMismatchError(error)) {
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}
