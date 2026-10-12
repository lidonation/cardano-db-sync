/**
 * Arrow-key movement for a tablist (A11Y-28, WAI-ARIA tabs pattern): Left/Right (Up/Down for a
 * vertical list) step to the previous/next enabled tab and wrap; Home/End jump to the first/last
 * enabled tab. Disabled tabs are skipped. Right means "next in reading order", so in a
 * right-to-left document the horizontal keys swap (DF-8). Returns the index to activate, or null
 * when the key is not a tab-navigation key.
 */
export function nextTab(
  key: string,
  current: number,
  enabled: readonly boolean[],
  {
    orientation = 'horizontal',
    rtl = false,
  }: {orientation?: 'horizontal' | 'vertical'; rtl?: boolean} = {},
): number | null {
  const count = enabled.length;
  if (count === 0 || !enabled.some(Boolean)) {
    return null;
  }
  const forward = orientation === 'vertical' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
  const backward = orientation === 'vertical' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
  const step = (from: number, delta: 1 | -1): number => {
    let index = from;
    do {
      index = (index + delta + count) % count;
    } while (!enabled[index]);
    return index;
  };
  switch (key) {
    case forward:
      return step(current, 1);
    case backward:
      return step(current, -1);
    case 'Home':
      return step(-1, 1);
    case 'End':
      return step(count, -1);
    default:
      return null;
  }
}
