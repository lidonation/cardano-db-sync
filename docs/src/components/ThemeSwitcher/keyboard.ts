/**
 * Arrow-key movement for the theme menu (B30, WAI-ARIA menu pattern): ArrowDown/ArrowUp
 * step to the next/previous option and wrap; Home/End jump to the first/last. Returns
 * the index to focus, or null when the key is not menu navigation. Escape and Tab are
 * handled by the component (close), not here. Pure so the unit suite covers it without
 * a browser; the component and the browser suite cover the rest (A11Y-29).
 */
export function nextMenuIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  const step = (from: number, delta: 1 | -1): number => (from + delta + count) % count;
  switch (key) {
    case 'ArrowDown':
      return step(current, 1);
    case 'ArrowUp':
      return step(current, -1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
