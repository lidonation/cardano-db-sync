import type {Page} from '@playwright/test';

/**
 * Every interactive element outside running prose, at least 44×44 CSS px (NAV-4, DF-6). Inline
 * links in a sentence are exempt (WCAG 2.5.8 "inline"); hidden and off-screen controls (the skip
 * link before it is focused, a collapsed panel) are not on screen to hit. A control drawn smaller
 * than its hit area (an absolutely positioned `::before` with negative insets, as Code / Copy
 * draws one) is measured by the hit area.
 */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const small: string[] = [];
    const selector =
      'a[href], button, input, select, textarea, summary, [role="button"], [tabindex]';
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (element.closest('.markdown p, .markdown li, .markdown td')) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || element.closest('[hidden], [aria-hidden="true"]')) {
        continue;
      }
      if (box.right <= 0 || box.bottom <= 0 || box.width <= 1 || box.height <= 1) continue;
      const hit = getComputedStyle(element, '::before');
      let [width, height] = [box.width, box.height];
      if (hit.content !== 'none' && hit.position === 'absolute') {
        const px = (value: string) => (value.endsWith('px') ? Math.min(0, parseFloat(value)) : 0);
        width -= px(hit.left) + px(hit.right);
        height -= px(hit.top) + px(hit.bottom);
      }
      if (Math.round(width) < 44 || Math.round(height) < 44) {
        const name = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
        small.push(
          `${element.tagName.toLowerCase()} "${name.slice(0, 30)}" ${Math.round(width)}×${Math.round(height)}`,
        );
      }
    }
    return small;
  });
}
