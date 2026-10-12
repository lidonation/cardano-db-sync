import path from 'node:path';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {adminDatabase} from '../../scripts/extract-schema.mjs';
import {
  applyMigrations,
  createDatabase,
  dropDatabase,
  migrationFiles,
  queryValue,
  replayPlan,
  selectMigrations,
} from '../../scripts/lib/schema-db.mjs';
import {SAMPLE_QUERIES} from '../../src/data/sample-queries';

/*
 * B44-a: the SQL the landing page shows an operator must run on the schema this build documents.
 * The design's draft balance query read `utxo_view`, which the schema no longer has; only planning
 * each query against the replayed migrations catches that. Default `core` variant. Run with
 * `npm run test:schema-db`, like the B08 replay tests: there is no skip without a server.
 */
const schemaDir = path.resolve(import.meta.dirname, '../../../schema');
const admin = adminDatabase();
const name = `dbsync_queries_${process.pid}_${Date.now()}`;

beforeAll(() => {
  const plan = replayPlan(selectMigrations(migrationFiles(schemaDir), 'core'));
  createDatabase(admin, name);
  applyMigrations(name, schemaDir, [...plan.beforeVariant, ...plan.afterVariant]);
});

afterAll(() => {
  dropDatabase(admin, name);
});

describe('landing sample queries plan against the replayed schema', () => {
  for (const [key, sql] of Object.entries(SAMPLE_QUERIES)) {
    it(key, () => {
      expect(() => queryValue(name, `EXPLAIN ${sql}`)).not.toThrow();
    });
  }
});

// Rewards are recorded after their earning epoch. An EXPLAIN cannot catch the wrong epoch filter.
describe('landing reward example result', () => {
  it('returns the latest recorded rewards when the current epoch is two epochs later', () => {
    const seed = `WITH reward(amount, earned_epoch) AS (VALUES (100::bigint, 8), (200::bigint, 8), (50::bigint, 7)), epoch(no) AS (VALUES (10))`;
    expect(queryValue(name, `${seed} ${SAMPLE_QUERIES.rewards}`)).toBe('300');
  });
});
