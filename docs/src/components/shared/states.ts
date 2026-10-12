/**
 * The state vocabulary every component speaks (FLOOR-5, DF-2, DF-4).
 *
 * Interaction states (hover, pressed, focus) come from the pointer and keyboard. The inventory can
 * also pin one with `demo`, which sets `data-dbs-demo` so the same CSS rule paints it at rest:
 * that is how every state is audited for contrast in every palette without a pointer.
 * Data states (loading, error, empty) are real props, because they come from the data.
 */
export type InteractionState = 'hover' | 'pressed' | 'focus';

export type DataStatus = 'ready' | 'loading' | 'error' | 'empty';

/** The nine states a control is drawn in on the B47 `DF-2 · States` boards. */
export const STATES = [
  'default',
  'hover',
  'pressed',
  'focus',
  'selected',
  'disabled',
  'loading',
  'error',
  'empty',
] as const;

export type State = (typeof STATES)[number];

/** Attributes that pin an interaction state for the inventory; nothing when not pinned. */
export function demoAttributes(demo: InteractionState | undefined): {'data-dbs-demo'?: string} {
  return demo ? {'data-dbs-demo': demo} : {};
}
