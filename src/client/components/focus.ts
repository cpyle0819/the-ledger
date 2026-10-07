/** The focused control, including controls inside nested shadow roots. */
export function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Visible controls in DOM order, including shadow roots and closed-details summaries. */
export function focusableElements(root: Element | ShadowRoot): HTMLElement[] {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  const result: HTMLElement[] = [];
  const walk = (parent: Element | ShadowRoot) => {
    for (const element of parent.children) {
      if (!(element instanceof HTMLElement) || element.hidden || element.getClientRects().length === 0 || getComputedStyle(element).visibility === 'hidden') continue;
      if (element.matches(selector)) result.push(element);
      if (element.shadowRoot) walk(element.shadowRoot);
      if (element instanceof HTMLDetailsElement && !element.open) {
        const summary = element.querySelector('summary');
        if (summary && summary.getClientRects().length) result.push(summary);
      } else walk(element);
    }
  };
  walk(root);
  return result;
}
