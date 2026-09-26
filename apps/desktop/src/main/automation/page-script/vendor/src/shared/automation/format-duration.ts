import type { AutomationLogEntry } from '../messaging/types/base';

export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  if (safe < 1000) return `${safe}ms`;
  if (safe < 60_000) return `${(safe / 1000).toFixed(1)}s`;
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function appendDurationLog(
  logs: AutomationLogEntry[],
  startedAt: number,
  kind: 'session' | 'task',
): void {
  const elapsed = Date.now() - startedAt;
  const prefix = kind === 'session' ? '本会话耗时' : '任务总耗时';
  logs.push({
    id: crypto.randomUUID(),
    level: 'info',
    message: `${prefix} ${formatDuration(elapsed)}`,
    timestamp: Date.now(),
  });
}
