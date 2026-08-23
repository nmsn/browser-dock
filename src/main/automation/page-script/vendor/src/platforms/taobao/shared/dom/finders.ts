import {
  findElementByText,
  normalizeVisibleText,
  waitForElementByText,
} from '../../../../shared/automation/dom-actions';

export function findClickableByText(text: string, root: ParentNode = document): Element | undefined {
  const preferredSelectors = [
    'button',
    '[role="button"]',
    'a',
  ];

  for (const selector of preferredSelectors) {
    const exactElement = findElementByText(text, {
      root,
      selector,
      exact: true,
    });

    if (exactElement) return exactElement;
  }

  for (const selector of preferredSelectors) {
    const fuzzyElement = findElementByText(text, {
      root,
      selector,
    });

    if (fuzzyElement) return fuzzyElement;
  }

  const fallback = findElementByText(text, {
    root,
    selector: 'span, div',
    exact: true,
  }) ?? findElementByText(text, {
    root,
    selector: 'span, div',
  });

  return fallback?.closest('button, [role="button"], a') ?? fallback;
}

export async function findClickableByTexts(texts: string[]): Promise<Element> {
  for (const text of texts) {
    const element = findClickableByText(text);

    if (element) {
      return element;
    }
  }

  return waitForElementByText(texts[0], {
    selector: 'button, [role="button"], a',
    timeoutMs: 5000,
  });
}

export function findInputInField(
  labels: string[],
  root?: ParentNode,
  options: {
    exclude?: Array<HTMLInputElement | HTMLTextAreaElement>;
    inputHint?: RegExp;
  } = {},
): HTMLInputElement | HTMLTextAreaElement | undefined {
  const searchRoot = root ?? document;

  for (const label of labels) {
    const labelElement = findElementByText(label, {
      root: searchRoot,
      selector: 'label, span, div, p',
      exact: true,
    }) ?? findElementByText(label, {
      root: searchRoot,
      selector: 'label, span, div, p',
    });

    const fieldInput = findInputInFieldContainer(labelElement, options);
    if (fieldInput) return fieldInput;
  }

  return findInputByAttributes(labels, searchRoot, options);
}

export function findInputNearLabels(
  labels: string[],
  root?: ParentNode,
): HTMLInputElement | HTMLTextAreaElement | undefined {
  const searchRoot = root ?? document;
  const directInput = findInputByAttributes(labels, searchRoot);
  if (directInput) return directInput;

  for (const label of labels) {
    const labelElement = findElementByText(label, {
      root: searchRoot,
      selector: 'label, span, div, p',
    });

    const scopedInput = findNearbyInput(labelElement);
    if (scopedInput) return scopedInput;
  }

  return undefined;
}

export function findInputByAttributes(
  labels: string[],
  root: ParentNode,
  options: {
    exclude?: Array<HTMLInputElement | HTMLTextAreaElement>;
    inputHint?: RegExp;
  } = {},
): HTMLInputElement | HTMLTextAreaElement | undefined {
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    .filter((input) => !input.disabled && input.type !== 'hidden' && !options.exclude?.includes(input));

  return inputs.find((input) => {
    const haystack = normalizeVisibleText([
      input.placeholder,
      input.name,
      input.id,
      input.getAttribute('aria-label'),
    ].filter(Boolean).join(' '));

    if (labels.some((label) => haystack.includes(label))) return true;
    return options.inputHint ? options.inputHint.test(haystack) : false;
  });
}

export function findInputInFieldContainer(
  labelElement: Element | undefined,
  options: {
    exclude?: Array<HTMLInputElement | HTMLTextAreaElement>;
    inputHint?: RegExp;
  } = {},
): HTMLInputElement | HTMLTextAreaElement | undefined {
  if (!labelElement) return undefined;

  const candidateRoots: Element[] = [];
  const seen = new Set<Element>();
  const push = (el: Element | null | undefined) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    candidateRoots.push(el);
  };

  push(labelElement.closest('[class*="form-item"]'));
  push(labelElement.closest('[class*="FormItem"]'));
  push(labelElement.closest('[class*="formItem"]'));
  push(labelElement.closest('[class*="form-field"]'));
  push(labelElement.closest('[class*="FormField"]'));
  push(labelElement.closest('[class*="form-row"]'));
  push(labelElement.closest('[class*="field"]'));
  push(labelElement.closest('label'));

  // 向上找「包含文本输入框」的祖先，避免只拿到纯标签节点
  let walker: Element | null = labelElement.parentElement;
  for (let depth = 0; depth < 10 && walker; depth += 1) {
    const textInput = findFirstUsableInput(walker, options);
    if (textInput) {
      push(walker);
      break;
    }
    walker = walker.parentElement;
  }

  push(labelElement.parentElement);
  push(labelElement.parentElement?.parentElement);

  for (const candidateRoot of candidateRoots) {
    const input = findFirstUsableInput(candidateRoot, options);
    if (input) return input;
  }

  return undefined;
}

export function findFirstUsableInput(
  root: ParentNode,
  options: {
    exclude?: Array<HTMLInputElement | HTMLTextAreaElement>;
    inputHint?: RegExp;
  } = {},
): HTMLInputElement | HTMLTextAreaElement | undefined {
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    .filter((input) => {
      if (input.disabled || options.exclude?.includes(input)) return false;
      if (input instanceof HTMLTextAreaElement) return true;
      const type = (input.type || 'text').toLowerCase();
      // 排除文件/勾选等，避免「直播标题」误命中封面 file 或旁侧 checkbox
      return !['hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image'].includes(type);
    });

  if (options.inputHint) {
    const hintedInput = inputs.find((input) => {
      const haystack = normalizeVisibleText([
        input.placeholder,
        input.name,
        input.id,
        input.getAttribute('aria-label'),
        input.getAttribute('class'),
      ].filter(Boolean).join(' '));

      return options.inputHint?.test(haystack);
    });

    if (hintedInput) return hintedInput;
  }

  return inputs[0];
}

export function findNearbyInput(labelElement?: Element): HTMLInputElement | HTMLTextAreaElement | undefined {
  if (!labelElement) return undefined;

  const candidateRoots = [
    labelElement.parentElement,
    labelElement.parentElement?.parentElement,
    labelElement.closest('label'),
    labelElement.closest('[class*="form"]'),
    labelElement.closest('[class*="Form"]'),
    labelElement.closest('[class*="item"]'),
    labelElement.closest('[class*="Item"]'),
  ].filter(Boolean) as Element[];

  for (const candidateRoot of candidateRoots) {
    const input = candidateRoot.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]), textarea');
    if (input && !input.disabled) return input;
  }

  return undefined;
}
