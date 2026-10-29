import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {packHistory} from '../../scripts/lib/guide-history.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'guide-locks-inprocess-'));
const originalArgs = process.argv;
afterEach(() => {
  process.argv = originalArgs;
  vi.restoreAllMocks();
  rmSync(root, {recursive: true, force: true});
});

it('runs the real gate in process through update, check, and drift reporting', async () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  const schema = {
    tables: [
      {
        name: 'tx_out',
        variant: 'core',
        kind: 'table',
        columns: [{name: 'value', fingerprint: 'before'}],
      },
    ],
  };
  const config = {config: {keys: []}};
  const write = (name: string, value: unknown) =>
    writeFileSync(path.join(root, 'generated', name), JSON.stringify(value));
  write('schema.json', schema);
  write('config-schema.json', config);
  write('versions.json', {versions: [{tag: 'v1'}]});
  write('guide-history.json', packHistory({versions: [{tag: 'v1', schema, config}]}));
  writeFileSync(
    path.join(root, 'docs/guides/example.md'),
    '---\nrequires:\n  columns: [tx_out.value]\n---\n`tx_out.value`\n',
  );
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.argv = ['node', 'gate', '--update'];
  vi.resetModules();
  await import('../../scripts/check-guide-locks.mjs');
  process.argv = ['node', 'gate'];
  vi.resetModules();
  await import('../../scripts/check-guide-locks.mjs');
  schema.tables[0].columns[0].fingerprint = 'after';
  write('schema.json', schema);
  vi.resetModules();
  await expect(import('../../scripts/check-guide-locks.mjs')).rejects.toThrow('exit:1');
  expect(exit).toHaveBeenCalledWith(1);
  expect(err.mock.calls.flat().join('\n')).toContain('Reviewed entity fingerprints changed');
});

it('fails closed for missing locks, missing history, bad history and removed guides', async () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  const schema = {
    tables: [
      {
        name: 'tx_out',
        variant: 'core',
        kind: 'table',
        columns: [{name: 'value', fingerprint: 'before'}],
      },
    ],
  };
  const config = {config: {keys: []}};
  const write = (name: string, value: unknown) =>
    writeFileSync(path.join(root, 'generated', name), JSON.stringify(value));
  write('schema.json', schema);
  write('config-schema.json', config);
  const guide = path.join(root, 'docs/guides/example.md');
  writeFileSync(guide, '---\nrequires:\n  columns: [tx_out.value]\n---\nBody\n');
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const invoke = async (update = false) => {
    process.argv = ['node', 'gate', ...(update ? ['--update'] : [])];
    vi.resetModules();
    return import('../../scripts/check-guide-locks.mjs');
  };
  await expect(invoke()).rejects.toThrow('exit:1');
  await expect(invoke(true)).rejects.toThrow('exit:1');
  write('versions.json', {versions: [{tag: 'v1'}]});
  write('guide-history.json', packHistory({versions: [{tag: 'different', schema, config}]}));
  await expect(invoke(true)).rejects.toThrow('exit:1');
  write('guide-history.json', packHistory({versions: [{tag: 'v1', schema, config}]}));
  await invoke(true);
  rmSync(guide);
  await expect(invoke()).rejects.toThrow('exit:1');
});

it('rejects unsafe guide paths and handles a missing guide directory', async () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  const write = (name: string, value: unknown) =>
    writeFileSync(path.join(root, 'generated', name), JSON.stringify(value));
  write('schema.json', {tables: []});
  write('config-schema.json', {config: {keys: []}});
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
  const invoke = async () => {
    process.argv = ['node', 'gate', '--update'];
    vi.resetModules();
    return import('../../scripts/check-guide-locks.mjs');
  };
  await invoke();
  mkdirSync(path.join(root, 'docs'), {recursive: true});
  mkdirSync(path.join(root, 'target'));
  symlinkSync(path.join(root, 'target'), path.join(root, 'docs/guides'));
  await expect(invoke()).rejects.toThrow('exit:1');
  rmSync(path.join(root, 'docs/guides'));
  mkdirSync(path.join(root, 'docs/guides/sub'), {recursive: true});
  writeFileSync(path.join(root, 'docs/guides/a.txt'), 'x');
  writeFileSync(path.join(root, 'docs/guides/b.txt'), 'x');
  symlinkSync(path.join(root, 'target'), path.join(root, 'docs/guides/link'));
  await expect(invoke()).rejects.toThrow('exit:1');
  rmSync(path.join(root, 'docs/guides'), {recursive: true});
  writeFileSync(path.join(root, 'docs/guides'), 'x');
  await expect(invoke()).rejects.toThrow('exit:1');
  rmSync(path.join(root, 'docs'), {recursive: true});
  symlinkSync(path.join(root, 'target'), path.join(root, 'docs'));
  await expect(invoke()).rejects.toThrow('exit:1');
});

it('reports unreviewed guides, warnings, changed ranges and invalid history', async () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
  const schema = {
    tables: [
      {
        name: 'tx_out',
        variant: 'core',
        kind: 'table',
        columns: [{name: 'value', fingerprint: 'before'}],
      },
    ],
  };
  const config = {config: {keys: []}};
  const write = (name: string, value: unknown) =>
    writeFileSync(path.join(root, 'generated', name), JSON.stringify(value));
  write('schema.json', schema);
  write('config-schema.json', config);
  write('versions.json', {versions: [{tag: 'v1'}]});
  const packed = packHistory({versions: [{tag: 'v1', schema, config}]});
  write('guide-history.json', packed);
  write('guide-locks.json', {schemaVersion: 1, guides: {}, ranges: {}});
  writeFileSync(
    path.join(root, 'docs/guides/example.md'),
    '---\nrequires:\n  tables: [tx_out]\n---\n`tx_out.value`\n',
  );
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
  const invoke = async (update = false) => {
    process.argv = ['node', 'gate', ...(update ? ['--update'] : [])];
    vi.resetModules();
    return import('../../scripts/check-guide-locks.mjs');
  };
  await expect(invoke()).rejects.toThrow('exit:1');
  await invoke(true);
  const lock = JSON.parse(readFileSync(path.join(root, 'generated/guide-locks.json'), 'utf8'));
  lock.ranges['docs/guides/example.md'] = ['v1'];
  write('guide-locks.json', lock);
  await expect(invoke()).rejects.toThrow('exit:1');
  packed.schemas[Object.keys(packed.schemas)[0]].tables = [];
  write('guide-history.json', packed);
  await expect(invoke()).rejects.toThrow('exit:1');
});
