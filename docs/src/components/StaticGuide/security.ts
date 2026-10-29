/** Keep authored links limited to ordinary navigation protocols. */
export function safeGuideHref(value: string, origin: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(value, origin).protocol);
  } catch {
    return false;
  }
}
/** Fetch only same-origin, non-executable HTTP(S) guide pages. */
export function safeGuideRequest(value: string, origin: string): boolean {
  try {
    const target = new URL(value, origin);
    return ['http:', 'https:'].includes(target.protocol) && target.origin === origin;
  } catch {
    return false;
  }
}
/** A new browsing context must not retain an opener. */
export function safeGuideTarget(target: string | null, rel: string | null): boolean {
  if (!target || target.toLowerCase() === '_self') return true;
  if (target.toLowerCase() !== '_blank') return false;
  const tokens = new Set((rel ?? '').toLowerCase().split(/\s+/));
  return tokens.has('noopener') || tokens.has('noreferrer');
}
