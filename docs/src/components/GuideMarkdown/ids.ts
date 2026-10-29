/** Stable DOM-safe identifiers do not depend on a contributor's visible label. */
export function procedureId(index: number): string {
  return `option-${index}`;
}
