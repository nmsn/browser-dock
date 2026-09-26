/**
 * 淘宝直播详情页头部开播状态（自 freelive-browser-extension dom/detail-live-status.ts 移植）。
 *
 * - 直播中：`.tdp-header-subtitle` 文案含「直播中」（如「直播中·0小时18分钟」）
 * - 彩排中：状态 tag / subtitle 含「彩排中」
 * - 未开播：状态 tag 文案为「未开播」
 *
 * 判读前须等 `document.readyState === 'complete'`，避免壳未渲染误判。
 */
import { normalizeVisibleText } from '../../../../shared/automation/dom-actions';
import { waitUntil, WaitInterval, WaitTimeout } from '../../../../shared/automation/wait';
import { queryAllDeep } from './deep-dom';

export type DetailLiveStatusKind = 'live' | 'rehearsal' | 'unpublished' | 'unknown';

export type DetailLiveStatusReading = {
  kind: DetailLiveStatusKind;
  /** 原始可见文案（已 normalize） */
  label: string;
};

const UNPUBLISHED_STATUS_SELECTOR = [
  '.live-anchor-kit-status-container',
  '.live-anchor-kit-status-container-new',
  '.live-anchor-kit-status-trailer-new',
  '.tdp-header-status',
].join(', ');

export function classifyDetailLiveStatus(text: string | undefined): DetailLiveStatusKind {
  const label = normalizeVisibleText(text ?? '');
  if (!label) return 'unknown';
  if (label.includes('彩排中')) return 'rehearsal';
  if (label.includes('直播中')) return 'live';
  if (label.includes('未开播')) return 'unpublished';
  return 'unknown';
}

export function isDetailLiveReady(kind: DetailLiveStatusKind): boolean {
  return kind === 'live' || kind === 'rehearsal';
}

/** 展示用：直播中 / 彩排中 / 未开播 / 未知 */
export function formatDetailLiveStatusKind(kind: DetailLiveStatusKind): string {
  switch (kind) {
    case 'live':
      return '直播中';
    case 'rehearsal':
      return '彩排中';
    case 'unpublished':
      return '未开播';
    default:
      return '未知';
  }
}

/** 等到 document 加载完成（complete）。 */
export async function waitForDocumentComplete(
  timeoutMs: number = WaitTimeout.default,
): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  if (document.readyState === 'complete') return true;
  const ok = await waitUntil(() => (document.readyState === 'complete' ? true : undefined), {
    timeoutMs,
    intervalMs: WaitInterval.default,
  });
  return Boolean(ok);
}

function readSubtitleTexts(): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const el of queryAllDeep<HTMLElement>('.tdp-header-subtitle')) {
    const label = normalizeVisibleText(el.textContent ?? '');
    if (!label || seen.has(label)) continue;
    seen.add(label);
    texts.push(label);
  }
  return texts;
}

function readStatusTagTexts(): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const el of queryAllDeep<HTMLElement>(UNPUBLISHED_STATUS_SELECTOR)) {
    const label = normalizeVisibleText(el.textContent ?? '');
    if (!label || seen.has(label)) continue;
    seen.add(label);
    texts.push(label);
  }
  return texts;
}

/**
 * 同步读取详情页开播状态（调用方应先保证页面已加载完成）。
 * 优先级：subtitle「直播中」→ 任意「彩排中」→ 状态 tag「未开播」。
 */
export function readDetailLiveStatus(): DetailLiveStatusReading {
  const subtitles = readSubtitleTexts();
  for (const label of subtitles) {
    if (label.includes('直播中')) {
      return { kind: 'live', label };
    }
  }

  for (const label of [...subtitles, ...readStatusTagTexts()]) {
    if (label.includes('彩排中')) {
      return { kind: 'rehearsal', label };
    }
  }

  for (const label of readStatusTagTexts()) {
    if (label.includes('未开播')) {
      return { kind: 'unpublished', label };
    }
  }

  const fallback = subtitles[0] ?? readStatusTagTexts()[0] ?? '';
  return { kind: 'unknown', label: fallback };
}

/**
 * 先等 document complete，再等到可读到 直播中/彩排中/未开播 之一；
 * 超时返回当前读数（可能 unknown）。
 */
export async function waitForDetailLiveStatus(
  timeoutMs: number = WaitTimeout.default,
): Promise<DetailLiveStatusReading> {
  const startedAt = Date.now();
  const loaded = await waitForDocumentComplete(timeoutMs);
  if (!loaded) {
    return { kind: 'unknown', label: '' };
  }

  const remainMs = Math.max(timeoutMs - (Date.now() - startedAt), WaitTimeout.short);
  const hit = await waitUntil(
    () => {
      const reading = readDetailLiveStatus();
      return reading.kind !== 'unknown' ? reading : undefined;
    },
    { timeoutMs: remainMs, intervalMs: WaitInterval.default },
  );
  return hit ?? readDetailLiveStatus();
}
