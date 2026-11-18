import path from 'node:path';
import {expect, it} from 'vitest';
import referencesPlugin, {references} from '../../plugins/schema-explorer/references.mjs';
it('generates forward links from the same lock used by the inverse table pages', () => {
  expect(references('docs/guides/schema-management.md')).toEqual(
    expect.arrayContaining([{url: '/schema/schema_version', label: 'schema_version'}]),
  );
  const address = references('docs/guides/database-encode-decode.md');
  expect(address).toContainEqual({
    url: '/schema/address/tx_out',
    label: 'tx_out (address)',
  });
  expect(address.some((link: {url: string}) => link.url === '/schema/tx_out')).toBe(false);
  expect(references('not-a-guide')).toEqual([]);
});
it('appends ordinary CommonMark schema links to current guides only', () => {
  const tree = {type: 'root', children: [] as object[]};
  const run = referencesPlugin();
  run(tree, {path: path.resolve('docs/guides/schema-management.md')});
  expect(tree.children).toHaveLength(2);
  const historical = {type: 'root', children: []};
  run(historical, {path: path.resolve('versioned_docs/version-13.7/guides/schema-management.md')});
  expect(historical.children).toHaveLength(0);
});
