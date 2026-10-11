import {beforeAll, describe, expect, it} from 'vitest';

import {extractArtifact} from '../../scripts/extract-schema.mjs';
import {changedFingerprints, domainTypedColumns} from '../../scripts/lib/schema-model.mjs';

/*
 * B08 against a real Postgres 17: the migrations are replayed, not modelled. Run with
 * `npm run test:schema-db` (PGHOST/PGUSER/PGPASSWORD in the environment); the extract-schema
 * workflow runs it against a postgres service container. There is no skip: without a server these
 * tests fail, because a green run that replayed nothing would prove nothing.
 *
 * The incident (SPECIFICATION GDE-6): migration 2-0030 dropped the CHECK constraint on every
 * domain. Not one column definition changed, so an existence check or a diff of doc/schema.md saw
 * nothing, while every domain-typed column's contract changed.
 */
type Artifact = ReturnType<typeof extractArtifact>['artifact'];

let head: ReturnType<typeof extractArtifact>;
let before: Artifact;
let after: Artifact;

beforeAll(() => {
  head = extractArtifact();
  before = extractArtifact({upTo: {stage: 2, version: 29}}).artifact;
  after = extractArtifact({upTo: {stage: 2, version: 30}}).artifact;
});

describe('the current schema', () => {
  it('replays cleanly and agrees with every Haskell schema record', () => {
    expect(head.problems).toEqual([]);
    expect(head.artifact.tables.length).toBeGreaterThan(70);
  });

  it('resolves the outsum chain to numeric(39,0) with no CHECK left', () => {
    expect(head.artifact.domains.outsum).toEqual({
      base: 'numeric(39,0)',
      domains: ['outsum', 'word128type'],
      checks: [],
      not_null: false,
    });
  });
});

describe('the 2-0030 domain migration (regression for the incident)', () => {
  it('before 2-0030, the outsum chain carries word128type’s CHECK', () => {
    expect(before.domains.outsum.domains).toEqual(['outsum', 'word128type']);
    expect(before.domains.outsum.checks).toEqual([
      {
        domain: 'word128type',
        definition:
          "CHECK (((VALUE >= (0)::numeric) AND (VALUE <= '340282366920938463463374607431768211455'::numeric)))",
      },
    ]);
  });

  it('flips the fingerprint of every domain-typed column, and of nothing else', () => {
    const typed = domainTypedColumns(before);
    const keys = new Set(
      before.tables.flatMap((t) =>
        t.columns
          .filter((c) => c.resolved_type.domains.length > 0)
          .map((c) => `${t.variant}:${t.name}.${c.name}`),
      ),
    );
    const changed = changedFingerprints(before, after);
    expect(new Set(changed)).toEqual(keys);
    // Recorded measurement (2026-10-11): 141 entries, 134 distinct columns once the two tx_out
    // variants are counted once. The spec's "179 of 580" came from doc/schema.md; this is the count
    // the migration itself produces.
    expect(typed).toHaveLength(141);
    expect(new Set(changed.map((k) => k.replace(/^[a-z]+:/, ''))).size).toBe(134);
  });

  it('changes no column definition: every flipped column keeps its declared type', () => {
    const declared = (a: Artifact) =>
      new Map(
        a.tables.flatMap((t) => t.columns.map((c) => [`${t.variant}:${t.name}.${c.name}`, c.type])),
      );
    const a = declared(before);
    const b = declared(after);
    for (const key of changedFingerprints(before, after)) expect(b.get(key)).toBe(a.get(key));
  });
});
