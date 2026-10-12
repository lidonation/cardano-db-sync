/**
 * The component inventory (B29): the 27 definitions the design file holds, the code that builds
 * each, and every state it ships (THM-5, FLOOR-5, DF-2, DF-4).
 *
 * The Penpot file holds 96 components that are 27 definitions — 23 drawn four times, once per
 * palette, plus 4 drawn once (THM-6). Here there is one entry per definition and no palette in any
 * name: themes are token values on `data-theme`, not component copies.
 *
 * Every entry accounts for all nine drawn states (B47 `DF-2 · States`). A state is either `shown`
 * — the inventory page renders the component in it, and the browser suite audits it in all four
 * palettes at three widths — or it does not apply, with the reason written down. "Not applicable"
 * is never silent: a component with only a default state is incomplete, not minimal (FLOOR-5).
 *
 * Pure data, imported by the inventory page, its browser tests and the unit tests.
 */
import {STATES, type State} from './shared/states';

/** A state that does not apply, and why. */
export interface NotApplicable {
  readonly na: string;
}

export type StateCoverage = 'shown' | NotApplicable;

export interface InventoryEntry {
  /** The definition's name in the design file. */
  readonly design: string;
  /** The `data-dbs-component` marker the rendered component carries. */
  readonly marker: string;
  /** Where it is built, under `src/components/`. */
  readonly module: string;
  /** How a page uses it. */
  readonly usage: string;
  /** Theme-invariant by ruling (THM-6): the same roles in every palette. */
  readonly invariant?: true;
  readonly interactive: boolean;
  readonly states: Readonly<Record<State, StateCoverage>>;
}

/** The THM-6 ruling (B29, 2026-10-12): the two unruled names drop their theme. */
export const RENAMED: Readonly<Record<string, string>> = {
  'Metric / Dark': 'Metric',
  'Avatar / Hexagon': 'Avatar',
};

/** Theme names that may not appear in a themed component's name (THM-6). */
export const THEME_WORDS = ['light', 'dark', 'cream', 'navy'] as const;

const all = (overrides: Partial<Record<State, StateCoverage>>): Record<State, StateCoverage> =>
  Object.fromEntries(STATES.map((state) => [state, overrides[state] ?? 'shown'])) as Record<
    State,
    StateCoverage
  >;

const na = (reason: string): NotApplicable => ({na: reason});

const ACTION = {
  selected: na('A button starts an action; nothing stays selected after it.'),
  empty: na('A button always has a label and an action, so it is never empty.'),
};
const LINK_CARD = {
  selected: na('A link card navigates; it is never selected.'),
  disabled: na('A card for a page or tool that is unavailable is not rendered, not disabled.'),
};
const STATIC_CARD = {
  hover: na('Not interactive: the card holds data, not an action.'),
  pressed: na('Not interactive.'),
  focus: na('Not interactive, so not focusable.'),
  selected: na('Not interactive.'),
  disabled: na('Not interactive.'),
};
const QUERY_CARD = {
  ...STATIC_CARD,
  hover: na('The card is not interactive; its link has the link states and FLOOR-4 ring.'),
  focus: na('The card is not focusable; its link is, and is covered by the focus walk.'),
};
const DECORATION = all({
  hover: na('Decoration: hidden from assistive technology, never interactive.'),
  pressed: na('Decoration.'),
  focus: na('Decoration.'),
  selected: na('Decoration.'),
  disabled: na('Decoration.'),
  loading: na('Decoration: holds no data.'),
  error: na('Decoration: holds no data.'),
  empty: na('Decoration: holds no data.'),
});
const BUILD_TIME = {
  loading: na('Rendered from build-time route data: nothing loads at run time.'),
  error: na('Rendered from build-time route data: nothing can fail at run time.'),
};

export const INVENTORY: readonly InventoryEntry[] = [
  {
    design: 'Navbar / Full',
    marker: 'Navbar / Full',
    module: 'Navbar',
    usage: '<NavbarFull links=… />',
    interactive: true,
    states: all({
      ...BUILD_TIME,
      disabled: na('A section that does not exist is not listed; links are never disabled.'),
      empty: na('The five sections are fixed site structure, never empty.'),
    }),
  },
  {
    design: 'Navbar / Minimal',
    marker: 'Navbar / Minimal',
    module: 'Navbar',
    usage: '<NavbarMinimal exit=… />',
    interactive: true,
    states: all({
      ...BUILD_TIME,
      selected: na('The minimal navbar has one link out and no current section.'),
      disabled: na('The way out is never disabled.'),
      empty: na('It always has the wordmark and the way out.'),
    }),
  },
  {
    design: 'Button / Primary',
    marker: 'Button',
    module: 'Button',
    usage: '<Button variant="primary">',
    interactive: true,
    states: all(ACTION),
  },
  {
    design: 'Button / Secondary',
    marker: 'Button',
    module: 'Button',
    usage: '<Button variant="secondary">',
    interactive: true,
    states: all(ACTION),
  },
  {
    design: 'Button / Ghost',
    marker: 'Button',
    module: 'Button',
    usage: '<Button variant="ghost">',
    interactive: true,
    states: all(ACTION),
  },
  {
    design: 'Button / Danger',
    marker: 'Button',
    module: 'Button',
    usage: '<Button variant="danger">',
    interactive: true,
    states: all(ACTION),
  },
  {
    design: 'Button / Disabled',
    marker: 'Button',
    module: 'Button',
    usage: '<Button disabled>',
    interactive: true,
    states: all({
      hover: na('Disabled: the pointer changes nothing (the cursor says not-allowed).'),
      pressed: na('Disabled: a press does nothing.'),
      selected: na('A button is never selected.'),
      disabled: na('This definition is the disabled state of every variant; its default is it.'),
      loading: na('A disabled button starts nothing, so it never loads.'),
      error: na('A disabled button starts nothing, so it never fails.'),
      empty: na('A button always has a label.'),
    }),
  },
  {
    design: 'Card / Tool',
    marker: 'Card / Tool',
    module: 'Card',
    usage: '<ToolCard name org description href />',
    interactive: true,
    states: all(LINK_CARD),
  },
  {
    design: 'Card / Team',
    marker: 'Card / Team',
    module: 'Card',
    usage: '<TeamCard name evidence href />',
    interactive: true,
    states: all(LINK_CARD),
  },
  {
    design: 'Card / Use case',
    marker: 'Card / Use case',
    module: 'Card',
    usage: '<UseCaseCard title description href? />',
    interactive: true,
    states: all(LINK_CARD),
  },
  {
    design: 'Card / Query',
    marker: 'Card / Query',
    module: 'Card',
    usage: '<QueryCard question sql linkLabel? href? copyable? />',
    interactive: false,
    states: all(QUERY_CARD),
  },
  {
    design: 'Card / Sample query',
    marker: 'Card / Sample query',
    module: 'Card',
    usage: '<SampleQueryCard returns sql />',
    interactive: false,
    states: all(STATIC_CARD),
  },
  {
    design: 'Card / Stat',
    marker: 'Card / Stat',
    module: 'Card',
    usage: '<StatCard label value fraction detail />',
    interactive: false,
    states: all(STATIC_CARD),
  },
  {
    design: 'Card / Choice',
    marker: 'Card / Choice',
    module: 'Card',
    usage: '<ChoiceCard name value label /> (checkbox)',
    interactive: true,
    states: all({}),
  },
  {
    design: 'Card / Option',
    marker: 'Card / Option',
    module: 'Card',
    usage: '<OptionCard name value label icon /> (radio)',
    interactive: true,
    states: all({}),
  },
  {
    design: 'Card / Data option',
    marker: 'Card / Data option',
    module: 'Card',
    usage: '<DataOptionCard configKey tables /> (switch)',
    interactive: true,
    states: all({}),
  },
  {
    design: 'Chip / Filter',
    marker: 'Chip / Filter',
    module: 'Tabs',
    usage: '<Tabs appearance="chip" items=… /> (tab pattern, A11Y-28)',
    interactive: true,
    states: all({}),
  },
  {
    design: 'Chip / Tag',
    marker: 'Chip / Tag',
    module: 'Tag',
    usage: '<Tag>12 columns</Tag>',
    interactive: false,
    states: all({
      hover: na('A tag states a fact; it is not a control.'),
      pressed: na('Not a control.'),
      focus: na('Not a control, so not focusable.'),
      selected: na('Not a control.'),
      disabled: na('Not a control.'),
      loading: na('Rendered with its data; the card that holds it has the loading state.'),
      error: na('Rendered with its data; the card that holds it has the error state.'),
      empty: na('A tag with no fact is not rendered.'),
    }),
  },
  {
    design: 'Section / Divider',
    marker: 'Section / Divider',
    module: 'Section',
    usage: '<SectionDivider />',
    interactive: false,
    states: DECORATION,
  },
  {
    design: 'Section / Cross',
    marker: 'Section / Cross',
    module: 'Section',
    usage: '<SectionCross />',
    interactive: false,
    states: DECORATION,
  },
  {
    design: 'Key / Cap',
    marker: 'Key / Cap',
    module: 'KeyCap',
    usage: '<KeyCap>esc</KeyCap> · <KeyCap enter />',
    interactive: false,
    states: all({
      hover: na('Static text naming a key.'),
      pressed: na('Static text.'),
      focus: na('Static text, not focusable.'),
      selected: na('Static text.'),
      disabled: na('Static text.'),
      loading: na('Static text: holds no data.'),
      error: na('Static text: holds no data.'),
      empty: na('A key cap always names a key.'),
    }),
  },
  {
    design: 'Search / Result',
    marker: 'Search / Result',
    module: 'SearchResult',
    usage: '<SearchResult id title meta selected /> in the ⌘K listbox',
    interactive: true,
    states: all({}),
  },
  {
    design: 'Pagination / Prev-Next',
    marker: 'Pagination / Prev-Next',
    module: 'Pagination',
    usage: '<Pagination previous next />',
    interactive: true,
    states: all({
      ...BUILD_TIME,
      selected: na('Both links lead away; neither is current.'),
      disabled: na('A missing side is left empty, not disabled (the empty state).'),
    }),
  },
  {
    design: 'Code / Copy',
    marker: 'Code / Copy',
    module: 'CodeCopy',
    usage: '<CodeCopy text />',
    invariant: true,
    interactive: true,
    states: all({empty: na('With nothing to copy the button is not rendered.')}),
  },
  {
    design: 'Avatar / Hexagon',
    marker: 'Avatar',
    module: 'Avatar',
    usage: '<Avatar name src href />',
    interactive: true,
    states: all({
      selected: na('A person is linked, never selected.'),
      disabled: na('A person is linked or not; there is nothing to disable.'),
    }),
  },
  {
    design: 'Footer / Navy',
    marker: 'Footer',
    module: 'Footer',
    usage: '<Footer meta columns note />',
    invariant: true,
    interactive: true,
    states: all({
      ...BUILD_TIME,
      selected: na('Footer links have no current page.'),
      disabled: na('Footer links are never disabled.'),
      empty: na('A column with no links is not rendered.'),
    }),
  },
  {
    design: 'Metric / Dark',
    marker: 'Metric',
    module: 'Metric',
    usage: '<Metric value label status />',
    interactive: false,
    states: all({
      hover: na('Not interactive: a figure and its label.'),
      pressed: na('Not interactive.'),
      focus: na('Not interactive, so not focusable.'),
      selected: na('Not interactive.'),
      disabled: na('Not interactive.'),
    }),
  },
];

/** The code name a definition is known by: its design name, or the THM-6 rename. */
export function codeName(entry: InventoryEntry): string {
  return RENAMED[entry.design] ?? entry.design;
}

/** The states the inventory renders for an entry, in drawing order. */
export function shownStates(entry: InventoryEntry): State[] {
  return STATES.filter((state) => entry.states[state] === 'shown');
}
