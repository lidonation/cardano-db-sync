/**
 * Breakpoints for TypeScript (matchMedia). CSS media queries cannot read custom properties, so
 * these mirror `breakpoint.*` in design/tokens.source.json; a unit test keeps them equal.
 * A query for "below md" is `(max-width: ${BREAKPOINTS.md - 1}px)`.
 */
export const BREAKPOINTS = Object.freeze({sm: 768, md: 1024, lg: 1280} as const);

export type Breakpoint = keyof typeof BREAKPOINTS;

/** `(min-width: Npx)` for a breakpoint. */
export const atLeast = (bp: Breakpoint): string => `(min-width: ${BREAKPOINTS[bp]}px)`;

/** `(max-width: N-1px)` for a breakpoint. */
export const below = (bp: Breakpoint): string => `(max-width: ${BREAKPOINTS[bp] - 1}px)`;
