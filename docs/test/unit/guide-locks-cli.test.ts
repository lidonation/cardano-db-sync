import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it} from 'vitest';
import * as prettier from 'prettier';
import {packHistory} from '../../scripts/lib/guide-history.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'guide-locks-'));
afterEach(() => rmSync(root, {recursive: true, force: true}));
it('requires an explicit review update and fails on subsequent schema drift', async () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  const schema = {
    tables: [
      {
        name: 'tx_out',
        variant: 'all',
        kind: 'table',
        columns: [{name: 'value', fingerprint: 'before'}],
      },
    ],
  };
  const schemaFile = path.join(root, 'generated/schema.json');
  writeFileSync(
    path.join(root, 'generated/versions.json'),
    JSON.stringify({versions: [{tag: 'v1'}]}),
  );
  writeFileSync(
    path.join(root, 'generated/guide-history.json'),
    JSON.stringify(packHistory({versions: [{tag: 'v1', schema, config: {config: {keys: []}}}]})),
  );
  writeFileSync(schemaFile, JSON.stringify(schema));
  writeFileSync(
    path.join(root, 'generated/config-schema.json'),
    JSON.stringify({config: {keys: []}}),
  );
  writeFileSync(
    path.join(root, 'docs/guides/example.md'),
    '---\nrequires:\n  columns: [tx_out.value]\n---\n`tx_out.value`\n',
  );
  const script = path.resolve('scripts/check-guide-locks.mjs');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {cwd: root, encoding: 'utf8'});
  expect(run().status).not.toBe(0);
  execFileSync(process.execPath, [script, '--update'], {cwd: root});
  const initial = readFileSync(path.join(root, 'generated/guide-locks.json'), 'utf8');
  expect(initial).toBe(await prettier.format(initial, {parser: 'json'}));
  expect(run().status).toBe(0);
  schema.tables[0].columns[0].fingerprint = 'after';
  writeFileSync(schemaFile, JSON.stringify(schema));
  const failed = run();
  expect(failed.status).not.toBe(0);
  expect(failed.stderr).toContain('docs/guides/example.md');
  expect(failed.stderr).toContain('before');
  expect(failed.stderr).toContain('after');
  expect(readFileSync(path.join(root, 'generated/guide-locks.json'), 'utf8')).toBe(initial);
});

it('reports a wide fingerprint change as one grouped result across guides', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  const columns = Array.from({length: 179}, (_, index) => ({
    name: `c${index}`,
    fingerprint: `before-${index}`,
  }));
  const schema = {tables: [{name: 'test_table', variant: 'all', kind: 'table', columns}]};
  const schemaFile = path.join(root, 'generated/schema.json');
  writeFileSync(
    path.join(root, 'generated/versions.json'),
    JSON.stringify({versions: [{tag: 'v1'}]}),
  );
  writeFileSync(
    path.join(root, 'generated/guide-history.json'),
    JSON.stringify(packHistory({versions: [{tag: 'v1', schema, config: {config: {keys: []}}}]})),
  );
  writeFileSync(schemaFile, JSON.stringify(schema));
  writeFileSync(
    path.join(root, 'generated/config-schema.json'),
    JSON.stringify({config: {keys: []}}),
  );
  for (const name of ['a', 'b']) {
    writeFileSync(
      path.join(root, `docs/guides/${name}.md`),
      `---\nrequires:\n  columns: [${columns.map((c) => `test_table.${c.name}`).join(', ')}]\n---\nGuide\n`,
    );
  }
  const script = path.resolve('scripts/check-guide-locks.mjs');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {cwd: root, encoding: 'utf8'});
  expect(run('--update').status).toBe(0);
  columns.forEach((column) => {
    column.fingerprint = `after-${column.name}`;
  });
  writeFileSync(schemaFile, JSON.stringify(schema));
  const failed = run();
  expect(failed.status).not.toBe(0);
  expect(failed.stderr.match(/Reviewed entity fingerprints changed/g)).toHaveLength(1);
  expect(failed.stderr).toContain('docs/guides/a.md');
  expect(failed.stderr).toContain('docs/guides/b.md');
  expect(failed.stderr).toContain('test_table.c178');
});

it('fails closed when guide history is missing, even when current entities exist', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  writeFileSync(path.join(root, 'generated/schema.json'), JSON.stringify({tables: []}));
  writeFileSync(
    path.join(root, 'generated/config-schema.json'),
    JSON.stringify({config: {keys: []}}),
  );
  writeFileSync(path.join(root, 'docs/guides/example.md'), '---\nrequires: {}\n---\nBody\n');
  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/check-guide-locks.mjs'), '--update'],
    {cwd: root, encoding: 'utf8'},
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('history');
});

it('does not silently skip a symlinked guide', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  writeFileSync(path.join(root, 'generated/schema.json'), JSON.stringify({tables: []}));
  writeFileSync(
    path.join(root, 'generated/config-schema.json'),
    JSON.stringify({config: {keys: []}}),
  );
  symlinkSync('/nonexistent', path.join(root, 'docs/guides/hidden.md'));
  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/check-guide-locks.mjs'), '--update'],
    {cwd: root, encoding: 'utf8'},
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('symlink');
});

it('rejects malformed reviewed lock maps even without authored guides', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  writeFileSync(path.join(root, 'generated/schema.json'), JSON.stringify({tables: []}));
  writeFileSync(
    path.join(root, 'generated/config-schema.json'),
    JSON.stringify({config: {keys: []}}),
  );
  writeFileSync(
    path.join(root, 'generated/guide-locks.json'),
    JSON.stringify({schemaVersion: 1, guides: [], ranges: {}}),
  );
  const result = spawnSync(process.execPath, [path.resolve('scripts/check-guide-locks.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(result.status).not.toBe(0);
});

it('rejects orphaned range entries', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  writeFileSync(path.join(root, 'generated/schema.json'), JSON.stringify({tables: []}));
  writeFileSync(
    path.join(root, 'generated/config-schema.json'),
    JSON.stringify({config: {keys: []}}),
  );
  writeFileSync(
    path.join(root, 'generated/guide-locks.json'),
    JSON.stringify({schemaVersion: 1, guides: {}, ranges: {'orphan.md': ['current']}}),
  );
  expect(
    spawnSync(process.execPath, [path.resolve('scripts/check-guide-locks.mjs')], {
      cwd: root,
      encoding: 'utf8',
    }).status,
  ).not.toBe(0);
});

it('rejects a symlink at the guide root', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs'), {recursive: true});
  writeFileSync(path.join(root, 'generated/schema.json'), JSON.stringify({tables: []}));
  writeFileSync(
    path.join(root, 'generated/config-schema.json'),
    JSON.stringify({config: {keys: []}}),
  );
  mkdirSync(path.join(root, 'empty-target'));
  symlinkSync(path.join(root, 'empty-target'), path.join(root, 'docs/guides'));
  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/check-guide-locks.mjs'), '--update'],
    {cwd: root, encoding: 'utf8'},
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('symlink');
});

it('rejects a symlinked docs parent before reading guide files', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'target'), {recursive: true});
  writeFileSync(path.join(root, 'generated/schema.json'), JSON.stringify({tables: []}));
  writeFileSync(
    path.join(root, 'generated/config-schema.json'),
    JSON.stringify({config: {keys: []}}),
  );
  symlinkSync(path.join(root, 'target'), path.join(root, 'docs'));
  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/check-guide-locks.mjs'), '--update'],
    {cwd: root, encoding: 'utf8'},
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('symlink');
});

it('does not silently ignore MDX guides', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  writeFileSync(path.join(root, 'generated/schema.json'), JSON.stringify({tables: []}));
  writeFileSync(
    path.join(root, 'generated/config-schema.json'),
    JSON.stringify({config: {keys: []}}),
  );
  writeFileSync(path.join(root, 'docs/guides/ignored.mdx'), 'No frontmatter');
  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/check-guide-locks.mjs'), '--update'],
    {cwd: root, encoding: 'utf8'},
  );
  expect(result.status).not.toBe(0);
});

it('records variant applicability and detects a changed variant range', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  const schema = {
    tables: [
      {
        name: 'tx_out',
        variant: 'core',
        kind: 'table',
        columns: [{name: 'core_only', fingerprint: 'a'}],
      },
      {
        name: 'tx_out',
        variant: 'address',
        kind: 'table',
        columns: [{name: 'address_only', fingerprint: 'b'}],
      },
    ],
  };
  const config = {config: {keys: []}};
  const write = (file: string, value: unknown) =>
    writeFileSync(path.join(root, 'generated', file), JSON.stringify(value));
  write('schema.json', schema);
  write('config-schema.json', config);
  write('versions.json', {versions: [{tag: 'v1'}]});
  write('guide-history.json', packHistory({versions: [{tag: 'v1', schema, config}]}));
  writeFileSync(
    path.join(root, 'docs/guides/example.md'),
    '---\nrequires:\n  columns: [tx_out.core_only]\n---\nBody\n',
  );
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [path.resolve('scripts/check-guide-locks.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  expect(run('--update').status).toBe(0);
  const lock = JSON.parse(readFileSync(path.join(root, 'generated/guide-locks.json'), 'utf8'));
  expect(lock.variants['docs/guides/example.md']).toEqual({v1: ['core'], current: ['core']});
  lock.variants['docs/guides/example.md'].current = ['address'];
  write('guide-locks.json', lock);
  expect(run().stderr).toContain('variants changed');
});

it('does not treat variant-map key order as a compatibility change', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  const schema = {
    tables: [
      {
        name: 'tx_out',
        variant: 'core',
        kind: 'table',
        columns: [{name: 'value', fingerprint: 'a'}],
      },
    ],
  };
  const config = {config: {keys: []}};
  const write = (file: string, value: unknown) =>
    writeFileSync(path.join(root, 'generated', file), JSON.stringify(value));
  write('schema.json', schema);
  write('config-schema.json', config);
  write('versions.json', {versions: [{tag: 'v1'}]});
  write('guide-history.json', packHistory({versions: [{tag: 'v1', schema, config}]}));
  writeFileSync(
    path.join(root, 'docs/guides/example.md'),
    '---\nrequires:\n  columns: [tx_out.value]\n---\nBody\n',
  );
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [path.resolve('scripts/check-guide-locks.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  expect(run('--update').status).toBe(0);
  const lock = JSON.parse(readFileSync(path.join(root, 'generated/guide-locks.json'), 'utf8'));
  lock.variants['docs/guides/example.md'] = {current: ['core'], v1: ['core']};
  write('guide-locks.json', lock);
  expect(run().status).toBe(0);
});

it('fails the real gate when an inherited config default changes', () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  const schema = {tables: []};
  const config = {
    config: {
      keys: [
        {
          name: 'options',
          required: false,
          default: {flag: false},
          shape: {
            type: 'object',
            haskell: 'Options',
            line: 1,
            keys: [{name: 'flag', required: false, shape: {type: 'boolean'}}],
          },
        },
      ],
    },
  };
  const write = (file: string, value: unknown) =>
    writeFileSync(path.join(root, 'generated', file), JSON.stringify(value));
  write('schema.json', schema);
  write('config-schema.json', config);
  write('versions.json', {versions: [{tag: 'v1'}]});
  write('guide-history.json', packHistory({versions: [{tag: 'v1', schema, config}]}));
  writeFileSync(
    path.join(root, 'docs/guides/config.md'),
    '---\nrequires:\n  config: [options.flag]\n---\nBody\n',
  );
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [path.resolve('scripts/check-guide-locks.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  expect(run('--update').status).toBe(0);
  expect(run().status).toBe(0);
  config.config.keys[0].default.flag = true;
  write('config-schema.json', config);
  const failed = run();
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain('docs/guides/config.md');
  expect(failed.stderr).toContain('"default":false');
  expect(failed.stderr).toContain('"default":true');
});
