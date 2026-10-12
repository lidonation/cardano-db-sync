/** WCAG relative luminance contrast. Invalid colours fail the audit instead of becoming NaN. */
export function contrast(a: string, b: string): number {
  const luminance = (colour: string) => {
    const channels = (colour.match(/[\d.]+/g) ?? []).map(Number);
    if (
      !/^rgba?\(/.test(colour) ||
      channels.length < 3 ||
      channels.some((v) => !Number.isFinite(v))
    ) {
      throw new Error(`Cannot measure computed colour: ${colour}`);
    }
    const [r, g, blue] = channels.slice(0, 3).map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Browser-only: composite this element's background and its ancestors, including translucent
 * active/hover washes. These fixtures use flat colour backgrounds, not images or gradients.
 * This function is self-contained so Playwright can serialize it into the page.
 */
export function paintedBackground(element: Element): string {
  const colour = [0, 0, 0];
  let coverage = 0;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.backgroundImage !== 'none')
      throw new Error('Background image needs a pixel measurement');
    const channels = (style.backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
    if (channels.length < 3) throw new Error(`Cannot composite ${style.backgroundColor}`);
    const alpha = channels[3] ?? 1;
    for (let i = 0; i < 3; i += 1) colour[i] += channels[i] * alpha * (1 - coverage);
    coverage += alpha * (1 - coverage);
    if (coverage >= 1) return `rgb(${colour.join(', ')})`;
  }
  throw new Error('No opaque backdrop found for the measurement');
}
