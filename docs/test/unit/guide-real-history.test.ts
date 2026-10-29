import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {configKeys, unpackHistory} from '../../scripts/lib/guide-history.mjs';
import {evaluateHistoricalGuide} from '../../scripts/lib/guide-locks.mjs';

it('derives real guide compatibility from retained tag snapshots and current contracts', () => {
  const history: Array<{
    tag: string;
    schema: {tables: Array<{name: string; columns: Array<{name: string}>}>};
    config: {config: {keys: unknown[]}};
  }> = unpackHistory(JSON.parse(readFileSync('generated/guide-history.json', 'utf8')));
  const schema = JSON.parse(readFileSync('generated/schema.json', 'utf8'));
  const config = JSON.parse(readFileSync('generated/config-schema.json', 'utf8'));
  history.push({tag: 'current', schema, config});
  const source =
    '---\nrequires:\n  tables: [tx_out]\n  columns: [tx_out.value, tx_out.consumed_by_tx_id]\n  config: [tx_out.value]\n---\nUse `tx_out.value`.\n';
  const result = evaluateHistoricalGuide('example.md', source, history);
  expect(result.errors).toEqual([]);
  const expected = history
    .filter((snapshot) => {
      const tables = snapshot.schema.tables.filter(
        (table: {name: string}) => table.name === 'tx_out',
      );
      return (
        ['value', 'consumed_by_tx_id'].every((name) =>
          tables.some((table: {columns: Array<{name: string}>}) =>
            table.columns.some((column) => column.name === name),
          ),
        ) && configKeys(snapshot.config).some((key: string) => key.endsWith('.tx_out.value'))
      );
    })
    .map((snapshot) => snapshot.tag);
  expect(result.versions).toEqual(expected);
  expect(result.versions).toContain('current');
  expect(Object.keys(result.lock)).toContain('columns:tx_out.consumed_by_tx_id');
});
