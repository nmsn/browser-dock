/**
 * 遍历当前 frame 可访问的 Document / 开放 ShadowRoot（含同域 iframe）。
 * 淘宝直播中控微前端常把业务卡片挂在 iframe 或 Shadow 里，顶层 document 搜不到文案。
 * 跨域 iframe 读不到 contentDocument，需 all_frames Content Script + Background 按 frame 投递。
 */
export type DomRoot = Document | ShadowRoot;

export function collectDomRoots(start: Document = document): DomRoot[] {
  const roots: DomRoot[] = [];
  const seen = new Set<DomRoot>();

  const visit = (root: DomRoot) => {
    if (seen.has(root)) return;
    seen.add(root);
    roots.push(root);

    let elements: Iterable<Element>;
    try {
      elements = root.querySelectorAll('*');
    } catch {
      return;
    }

    for (const el of elements) {
      if (el.shadowRoot) {
        visit(el.shadowRoot);
      }
      if (el instanceof HTMLIFrameElement) {
        try {
          const doc = el.contentDocument;
          if (doc) visit(doc);
        } catch {
          // 跨域 iframe：顶层读不到，需 all_frames Content Script
        }
      }
    }
  };

  visit(start);
  return roots;
}

export function queryAllDeep<T extends Element = Element>(
  selector: string,
  start: Document = document,
): T[] {
  const out: T[] = [];
  for (const root of collectDomRoots(start)) {
    try {
      out.push(...Array.from(root.querySelectorAll<T>(selector)));
    } catch {
      // ignore invalid root
    }
  }
  return out;
}

export function describeDomRoots(start: Document = document): string {
  const roots = collectDomRoots(start);
  const iframes = Array.from(start.querySelectorAll('iframe'));
  const iframeUrls = iframes.map((frame) => {
    try {
      return frame.src || frame.contentDocument?.location?.href || '(empty-src)';
    } catch {
      return `${frame.src || '(no-src)'}[cross-origin]`;
    }
  });

  let shadowCount = 0;
  for (const root of roots) {
    if (root instanceof ShadowRoot) shadowCount += 1;
  }

  return [
    `roots=${roots.length}`,
    `shadow=${shadowCount}`,
    `iframes=${iframes.length}`,
    iframeUrls.length ? `iframeSrc=[${iframeUrls.slice(0, 5).join(' | ')}]` : '',
  ]
    .filter(Boolean)
    .join('; ');
}
