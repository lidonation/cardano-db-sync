import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {
  INVENTORY,
  RENAMED,
  THEME_WORDS,
  codeName,
  shownStates,
} from '../../src/components/inventory';
import {STATES, demoAttributes} from '../../src/components/shared/states';

const COMPONENTS = path.resolve(import.meta.dirname, '../../src/components');

/** The 27 definitions in the design file (DESIGN.md §8, `M · Component Mains`). */
const DESIGN_DEFINITIONS = [
  'Button / Primary',
  'Button / Secondary',
  'Button / Ghost',
  'Button / Danger',
  'Button / Disabled',
  'Card / Choice',
  'Card / Data option',
  'Card / Option',
  'Card / Query',
  'Card / Sample query',
  'Card / Stat',
  'Card / Team',
  'Card / Tool',
  'Card / Use case',
  'Chip / Filter',
  'Chip / Tag',
  'Navbar / Full',
  'Navbar / Minimal',
  'Section / Cross',
  'Section / Divider',
  'Key / Cap',
  'Search / Result',
  'Pagination / Prev-Next',
  'Code / Copy',
  'Avatar / Hexagon',
  'Footer / Navy',
  'Metric / Dark',
];

/** Every source file of a component module, concatenated. */
function moduleSource(module: string): string {
  const dir = path.join(COMPONENTS, module);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    .join('\n');
}

describe('component inventory (THM-5, THM-6)', () => {
  it('holds the 27 design definitions, each once', () => {
    const designs = INVENTORY.map((entry) => entry.design);
    expect(new Set(designs).size).toBe(designs.length);
    expect([...designs].sort()).toEqual([...DESIGN_DEFINITIONS].sort());
  });

  it('names no themed component for a theme', () => {
    const themed = INVENTORY.filter((entry) => !entry.invariant).flatMap((entry) =>
      [codeName(entry), entry.marker, entry.module].filter((name) =>
        THEME_WORDS.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(name)),
      ),
    );
    expect(themed).toEqual([]);
  });

  it('records the THM-6 ruling: Metric and Avatar are themed and renamed', () => {
    expect(RENAMED).toEqual({'Metric / Dark': 'Metric', 'Avatar / Hexagon': 'Avatar'});
    const invariant = INVENTORY.filter((entry) => entry.invariant).map((entry) => entry.design);
    expect(invariant.sort()).toEqual(['Code / Copy', 'Footer / Navy']);
  });

  it('builds every entry where it says, under the marker it declares', () => {
    const declared = (entry: (typeof INVENTORY)[number]) => {
      const source = moduleSource(entry.module);
      const [family] = entry.marker.split(' / ');
      // a literal marker, or the Card frame's `Card / ${kind}` with this kind passed in
      return (
        source.includes(`'${entry.marker}'`) ||
        source.includes(`"${entry.marker}"`) ||
        (source.includes(`\`${family} / \${kind}\``) &&
          source.includes(`kind="${entry.marker.slice(family.length + 3)}"`))
      );
    };
    const wrong = INVENTORY.filter((entry) => !declared(entry)).map((entry) => entry.design);
    expect(wrong).toEqual([]);
  });
});

describe('component states (FLOOR-5, DF-2, DF-4)', () => {
  it('accounts for all nine drawn states on every entry, with a reason for each one skipped', () => {
    for (const entry of INVENTORY) {
      expect(Object.keys(entry.states).sort()).toEqual([...STATES].sort());
      for (const state of STATES) {
        const coverage = entry.states[state];
        if (coverage !== 'shown') {
          expect(coverage.na.length, `${entry.design} · ${state}`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('shows hover and focus on every interactive component (FLOOR-5)', () => {
    const missing = INVENTORY.filter((entry) => entry.interactive)
      .filter((entry) => entry.design !== 'Button / Disabled')
      .filter(
        (entry) =>
          !['hover', 'focus'].every((state) => shownStates(entry).includes(state as never)),
      )
      .map((entry) => entry.design);
    expect(missing).toEqual([]);
  });

  it('shows loading, error and empty wherever a component holds run-time data (DF-4)', () => {
    const data = INVENTORY.filter((entry) => entry.states.loading === 'shown');
    for (const entry of data) {
      expect(shownStates(entry), entry.design).toEqual(expect.arrayContaining(['error']));
    }
    expect(data.length).toBeGreaterThanOrEqual(15);
  });

  it('lists shown states in drawing order', () => {
    const choice = INVENTORY.find((entry) => entry.design === 'Card / Choice');
    expect(choice && shownStates(choice)).toEqual([...STATES]);
  });
});

describe('pinned interaction states', () => {
  it('marks a pinned state for the inventory and nothing otherwise', () => {
    expect(demoAttributes('hover')).toEqual({'data-dbs-demo': 'hover'});
    expect(demoAttributes(undefined)).toEqual({});
  });
});
