import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  major: 17,
  stageTwo: 48,
  stageFour: 9,
  unresolved: false,
  address: false,
}));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  const fs = await import('node:fs');
  return {
    ...actual,
    execFileSync: vi.fn((command: string, args: string[]) => {
      if (command === 'cabal') return 'fixture-extractor';
      if (command === 'git') return Buffer.from('archive');
      if (command === 'tar' && state.address) {
        const f = path.join(args[3], 'cardano-db/src/Cardano/Db/Statement/ConsumedTxOut.hs');
        fs.mkdirSync(path.dirname(f), {recursive: true});
        fs.writeFileSync(f, 'fixture');
      }
      if (command === 'mkdir') fs.mkdirSync(args[1], {recursive: true});
      if (command === 'fixture-extractor')
        fs.writeFileSync(
          args[3],
          JSON.stringify({config: {keys: []}, unresolved: state.unresolved ? ['unknown'] : []}),
        );
      return Buffer.from('');
    }),
  };
});
vi.mock('../../scripts/lib/schema-db.mjs', () => ({
  applyMigrations: vi.fn(),
  applySql: vi.fn(),
  createDatabase: vi.fn(),
  dropDatabase: vi.fn(),
  migrationFiles: vi.fn(() => [{stage: 4, version: state.stageFour, name: 'migration.sql'}]),
  selectMigrations: vi.fn((files) => files),
  serverMajor: vi.fn(() => state.major),
  readCatalog: vi.fn(() => ({
    schemaVersion: {stage_two: state.stageTwo},
    types: new Map(),
    tables: new Map(),
  })),
}));
vi.mock('../../scripts/lib/schema-haskell.mjs', () => ({
  readAddressVariantDdl: vi.fn(() => ['SELECT 1']),
}));

const root = mkdtempSync(path.join(os.tmpdir(), 'guide-history-inprocess-'));
const oldArgs = process.argv;
const oldBin = process.env.CONFIG_EXTRACTOR_BIN;
afterEach(() => {
  process.argv = oldArgs;
  if (oldBin === undefined) delete process.env.CONFIG_EXTRACTOR_BIN;
  else process.env.CONFIG_EXTRACTOR_BIN = oldBin;
  state.major = 17;
  state.stageTwo = 48;
  state.stageFour = 9;
  state.unresolved = false;
  state.address = false;
  vi.restoreAllMocks();
  rmSync(root, {recursive: true, force: true});
});

it('regenerates and checks the release history using the actual entry point', async () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  writeFileSync(
    path.join(root, 'generated/versions.json'),
    JSON.stringify({versions: [{tag: '13.7.1.0', stage_two: '0048', stage_four: '0009'}]}),
  );
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.env.CONFIG_EXTRACTOR_BIN = 'fixture-extractor';
  process.argv = ['node', 'extract'];
  vi.resetModules();
  await import('../../scripts/extract-guide-history.mjs');
  const artifact = JSON.parse(
    readFileSync(path.join(root, 'generated/guide-history.json'), 'utf8'),
  );
  expect(artifact.versions.map((entry: {tag: string}) => entry.tag)).toEqual(['13.7.1.0']);
  process.argv = ['node', 'extract', '--check'];
  vi.resetModules();
  await import('../../scripts/extract-guide-history.mjs');
});

it('fails closed on incompatible servers, invalid release metadata, replay drift and unresolved config', async () => {
  mkdirSync(path.join(root, 'generated'), {recursive: true});
  const versionFile = path.join(root, 'generated/versions.json');
  const write = (tag: string) =>
    writeFileSync(
      versionFile,
      JSON.stringify({versions: [{tag, stage_two: '0048', stage_four: '0009'}]}),
    );
  write('13.7.1.0');
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.env.CONFIG_EXTRACTOR_BIN = 'fixture-extractor';
  process.argv = ['node', 'extract'];
  const invoke = async () => {
    vi.resetModules();
    return import('../../scripts/extract-guide-history.mjs');
  };
  state.major = 16;
  await expect(invoke()).rejects.toThrow('Postgres 17');
  state.major = 17;
  write('--bad');
  await expect(invoke()).rejects.toThrow('invalid release metadata');
  write('13.7.1.0');
  state.stageFour = 8;
  await expect(invoke()).rejects.toThrow('stage four');
  state.stageFour = 9;
  state.stageTwo = 47;
  await expect(invoke()).rejects.toThrow('stage two');
  state.stageTwo = 48;
  state.unresolved = true;
  await expect(invoke()).rejects.toThrow('unresolved configuration');
  state.unresolved = false;
  state.address = true;
  await invoke();
  rmSync(path.join(root, 'generated/guide-history.json'));
  process.argv = ['node', 'extract', '--check'];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
  await expect(invoke()).rejects.toThrow('exit:1');
});
