import type { AutomationLogEntry, AutomationLogLevel } from '../messaging/types/base';
import { sleepMs } from './sleep';

const MAX_LOG_ENTRIES = 200;
const Z_INDEX = '2147483646';

export type AutomationSession = {
  id: string;
  label: string;
  stepLabel: string;
  startedAt: number;
  controller: AbortController;
  signal: AbortSignal;
};

export type ExecutionGuard = ReturnType<typeof createExecutionGuard>;

export class AutomationCancelledError extends Error {
  constructor(message = '自动化已取消') {
    super(message);
    this.name = 'AutomationCancelledError';
  }
}

export function isAutomationCancelledError(error: unknown): error is AutomationCancelledError {
  return error instanceof AutomationCancelledError
    || (error instanceof DOMException && error.name === 'AbortError');
}

export function createExecutionGuard() {
  let activeSession: AutomationSession | undefined;
  let host: HTMLDivElement | undefined;
  let shadowRoot: ShadowRoot | undefined;
  let panelEl: HTMLElement | undefined;
  let headerEl: HTMLElement | undefined;
  let titleEl: HTMLElement | undefined;
  let stepEl: HTMLElement | undefined;
  let logListEl: HTMLElement | undefined;
  let resultEl: HTMLElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;
  let closeButton: HTMLButtonElement | undefined;
  let keydownHandler: ((event: KeyboardEvent) => void) | undefined;
  let dragPointerId: number | undefined;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let onDragMove: ((event: PointerEvent) => void) | undefined;
  let onDragEnd: ((event: PointerEvent) => void) | undefined;

  function ensureDom() {
    // 扩展热更新后可能残留旧 host（无拖拽逻辑），先清掉再建
    const existing = document.getElementById('live-ext-automation-host');
    if (existing && (existing !== host || existing.dataset.version !== 'drag-v3')) {
      existing.remove();
      if (existing === host) {
        host = undefined;
        shadowRoot = undefined;
        panelEl = undefined;
        headerEl = undefined;
      }
    }
    if (host?.isConnected) {
      return;
    }

    host = document.createElement('div');
    host.id = 'live-ext-automation-host';
    host.dataset.version = 'drag-v3';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = Z_INDEX;
    host.style.display = 'none';
    // 遮罩不拦截指针（穿透到页面），否则 CDP 可信点击会被命中测试吞掉；面板自身保持可交互
    host.style.pointerEvents = 'none';

    shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .shield {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.42);
          pointer-events: none;
        }
        .panel {
          position: fixed;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: min(520px, calc(100vw - 32px));
          max-height: min(72vh, 720px);
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          z-index: 1;
          /* 面板本体不拦截指针（CDP 可信点击需穿透到页面）；仅交互区单独开启 */
          pointer-events: none;
        }
        .panel.is-dragged {
          transform: none;
        }
        .header {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 16px 18px 12px;
          border-bottom: 1px solid #ebeef5;
          cursor: grab;
          user-select: none;
          touch-action: none;
          pointer-events: auto;
        }
        .header.is-dragging {
          cursor: grabbing;
        }
        .drag-handle {
          flex: 0 0 auto;
          margin-top: 2px;
          padding: 4px 6px;
          border-radius: 6px;
          background: #f2f3f5;
          color: #909399;
          font: 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 1px;
        }
        .header-text {
          flex: 1;
          min-width: 0;
        }
        .title {
          margin: 0;
          font: 600 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #303133;
          pointer-events: none;
        }
        .step {
          margin: 6px 0 0;
          font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #606266;
          pointer-events: none;
        }
        .log-list {
          flex: 1;
          min-height: 220px;
          max-height: 55vh;
          overflow-y: auto;
          padding: 12px 18px;
          background: #fafafa;
          /* 执行期间不拦截指针，避免挡住页面上的 CDP 点击目标 */
          pointer-events: none;
        }
        .log-item {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          margin-bottom: 8px;
          font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
          color: #303133;
          word-break: break-word;
        }
        .log-level {
          flex: 0 0 auto;
          padding: 1px 6px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
        }
        .log-level.info { background: #ecf5ff; color: #409eff; }
        .log-level.success { background: #f0f9eb; color: #67c23a; }
        .log-level.warning { background: #fdf6ec; color: #e6a23c; }
        .log-level.error { background: #fef0f0; color: #f56c6c; }
        .footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 18px 16px;
          border-top: 1px solid #ebeef5;
        }
        .hint {
          font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #909399;
        }
        .actions {
          display: flex;
          gap: 8px;
        }
        button {
          border: none;
          border-radius: 8px;
          padding: 8px 14px;
          font: 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
          pointer-events: auto;
        }
        .cancel-btn {
          background: #f56c6c;
          color: #fff;
        }
        .close-btn {
          background: #409eff;
          color: #fff;
        }
        .result {
          display: none;
          padding: 10px 18px 0;
          font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .result.visible { display: block; }
        .result.success { color: #67c23a; }
        .result.error { color: #f56c6c; }
      </style>
      <div class="shield">
        <div class="panel">
          <div class="header" title="按住此处拖拽移动面板">
            <span class="drag-handle" aria-hidden="true">⋮⋮ 拖拽</span>
            <div class="header-text">
              <h2 class="title"></h2>
              <p class="step"></p>
            </div>
          </div>
          <div class="result"></div>
          <div class="log-list"></div>
          <div class="footer">
            <span class="hint">按住标题栏拖拽移动 · Esc 取消</span>
            <div class="actions">
              <button type="button" class="cancel-btn">取消执行</button>
              <button type="button" class="close-btn" hidden>关闭</button>
            </div>
          </div>
        </div>
      </div>
    `;

    panelEl = shadowRoot.querySelector('.panel') ?? undefined;
    headerEl = shadowRoot.querySelector('.header') ?? undefined;
    titleEl = shadowRoot.querySelector('.title') ?? undefined;
    stepEl = shadowRoot.querySelector('.step') ?? undefined;
    logListEl = shadowRoot.querySelector('.log-list') ?? undefined;
    resultEl = shadowRoot.querySelector('.result') ?? undefined;
    cancelButton = shadowRoot.querySelector('.cancel-btn') ?? undefined;
    closeButton = shadowRoot.querySelector('.close-btn') ?? undefined;

    cancelButton?.addEventListener('click', () => {
      abort();
    });

    closeButton?.addEventListener('click', () => {
      hide();
    });

    bindPanelDrag();
    document.documentElement.appendChild(host);
  }

  function resetPanelPosition() {
    endPanelDrag();
    if (!panelEl) return;
    panelEl.classList.remove('is-dragged');
    panelEl.style.left = '';
    panelEl.style.top = '';
    panelEl.style.transform = '';
  }

  function clampPanelPosition(left: number, top: number): { left: number; top: number } {
    if (!panelEl) return { left, top };
    const margin = 8;
    const width = panelEl.offsetWidth || 320;
    const height = panelEl.offsetHeight || 240;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop),
    };
  }

  function placePanelAt(left: number, top: number) {
    if (!panelEl) return;
    const next = clampPanelPosition(left, top);
    panelEl.classList.add('is-dragged');
    panelEl.style.transform = 'none';
    panelEl.style.left = `${Math.round(next.left)}px`;
    panelEl.style.top = `${Math.round(next.top)}px`;
  }

  function endPanelDrag() {
    if (onDragMove) {
      window.removeEventListener('pointermove', onDragMove, true);
      onDragMove = undefined;
    }
    if (onDragEnd) {
      window.removeEventListener('pointerup', onDragEnd, true);
      window.removeEventListener('pointercancel', onDragEnd, true);
      onDragEnd = undefined;
    }
    headerEl?.classList.remove('is-dragging');
    dragPointerId = undefined;
  }

  function bindPanelDrag() {
    if (!headerEl || !panelEl) return;

    headerEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if ((event.target as Element | null)?.closest?.('button')) return;
      if (!panelEl || !headerEl) return;

      // 从当前视觉位置切到 left/top 像素定位（去掉居中 transform）
      const rect = panelEl.getBoundingClientRect();
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      dragPointerId = event.pointerId;
      placePanelAt(rect.left, rect.top);
      headerEl.classList.add('is-dragging');

      onDragMove = (moveEvent: PointerEvent) => {
        if (dragPointerId !== moveEvent.pointerId) return;
        placePanelAt(moveEvent.clientX - dragOffsetX, moveEvent.clientY - dragOffsetY);
      };
      onDragEnd = (upEvent: PointerEvent) => {
        if (dragPointerId !== upEvent.pointerId) return;
        endPanelDrag();
      };

      // 挂在 window 捕获阶段：光标移出标题栏/Shadow DOM 仍能拖
      window.addEventListener('pointermove', onDragMove, true);
      window.addEventListener('pointerup', onDragEnd, true);
      window.addEventListener('pointercancel', onDragEnd, true);
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function show(session: AutomationSession) {
    ensureDom();
    if (!host || !titleEl || !stepEl || !logListEl || !resultEl || !cancelButton || !closeButton) {
      return;
    }

    // 每次新任务都回到中央；拖拽位置不跨任务保留
    resetPanelPosition();
    titleEl.textContent = `自动化执行中：${session.label}`;
    stepEl.textContent = session.stepLabel;
    logListEl.innerHTML = '';
    resultEl.textContent = '';
    resultEl.className = 'result';
    cancelButton.hidden = false;
    closeButton.hidden = true;
    host.style.display = 'block';
  }

  function hide() {
    if (host) {
      host.style.display = 'none';
    }
  }

  function bindEscape() {
    keydownHandler = (event: KeyboardEvent) => {
      // 忽略自动化脚本派发的 Escape（如关闭日期时间面板），只响应真实用户按键
      if (event.key === 'Escape' && event.isTrusted) {
        event.preventDefault();
        abort();
      }
    };

    window.addEventListener('keydown', keydownHandler, true);
  }

  function unbindEscape() {
    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = undefined;
    }
  }

  function isActive() {
    return Boolean(activeSession);
  }

  function acquire(label: string): AutomationSession {
    if (activeSession) {
      throw new Error('当前已有自动化任务在执行');
    }

    const controller = new AbortController();
    const session: AutomationSession = {
      id: crypto.randomUUID(),
      label,
      stepLabel: '准备开始…',
      startedAt: Date.now(),
      controller,
      signal: controller.signal,
    };

    activeSession = session;
    show(session);
    bindEscape();
    return session;
  }

  function release(sessionId: string) {
    if (activeSession?.id !== sessionId) {
      return;
    }

    unbindEscape();
    activeSession = undefined;
    hide();
  }

  function abort(sessionId?: string) {
    if (!activeSession) {
      return;
    }

    if (sessionId && activeSession.id !== sessionId) {
      return;
    }

    activeSession.controller.abort();
  }

  function updateLabel(sessionId: string, label: string) {
    if (activeSession?.id !== sessionId) {
      return;
    }

    activeSession.stepLabel = label;
    if (stepEl) {
      stepEl.textContent = label;
    }
  }

  function appendLog(entry: AutomationLogEntry) {
    if (!logListEl) {
      return;
    }

    while (logListEl.childElementCount >= MAX_LOG_ENTRIES) {
      logListEl.firstElementChild?.remove();
    }

    const item = document.createElement('div');
    item.className = 'log-item';

    const level = document.createElement('span');
    level.className = `log-level ${entry.level}`;
    level.textContent = entry.level;

    const message = document.createElement('span');
    message.textContent = entry.message;

    item.append(level, message);
    logListEl.append(item);
    logListEl.scrollTop = logListEl.scrollHeight;
  }

  async function showResult(summary: { success: boolean; message: string }, autoHideMs = 0) {
    if (!resultEl || !cancelButton || !closeButton) {
      return;
    }

    resultEl.textContent = summary.message;
    resultEl.className = `result visible ${summary.success ? 'success' : 'error'}`;
    cancelButton.hidden = true;
    closeButton.hidden = false;

    if (autoHideMs > 0) {
      await sleepMs(autoHideMs);
      hide();
    }
  }

  return {
    isActive,
    acquire,
    release,
    abort,
    updateLabel,
    appendLog,
    showResult,
    getActiveSessionId: () => activeSession?.id,
  };
}

export function createLogAppender(
  guard: ExecutionGuard,
  logs: AutomationLogEntry[],
  scope: string,
) {
  return (level: AutomationLogLevel, message: string) => {
    const entry: AutomationLogEntry = {
      id: crypto.randomUUID(),
      level,
      message,
      timestamp: Date.now(),
    };

    logs.push(entry);
    guard.appendLog(entry);
    console.info(`[freelive-browser-extension][${scope}]`, entry);
  };
}
