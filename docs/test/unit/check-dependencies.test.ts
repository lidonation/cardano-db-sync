import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  REVIEW_GATED,
  main,
  pinProblems,
  reviewGateProblems,
} from '../../scripts/check-dependencies.mjs';

const PKG = {dependencies: {react: '19.3.0'}, devDependencies: {vitest: '5.0.3-beta.1'}};
const LOCK = {lockfileVersion: 3, packages: {'': {}}};
const NPMRC = 'save-exact=true\n';

const messages = (problems: {rule: string; message: string}[]) =>
  problems.map((p) => `${p.rule} ${p.message}`);

describe('SEC-5 pins', () => {
  it('passes exact versions, save-exact and a hashed lockfile', () => {
    expect(pinProblems(PKG, NPMRC, LOCK)).toEqual([]);
  });

  it.each(['^19.0.0', '~5.6.0', 'latest', '*', 'github:a/b', 'https://x/y.tgz', '>=1.0.0'])(
    'flags "%s"',
    (spec) => {
      expect(messages(pinProblems({dependencies: {x: spec}}, NPMRC, LOCK))).toEqual([
        `SEC-5 dependencies.x is "${spec}", not an exact version`,
      ]);
    },
  );

  it('needs save-exact and a lockfile with a packages map', () => {
    expect(messages(pinProblems(PKG, '', null))).toEqual([
      'SEC-5 .npmrc does not set save-exact=true',
      'SEC-5 package-lock.json is missing',
    ]);
    expect(messages(pinProblems(PKG, NPMRC, {lockfileVersion: 1}))).toEqual([
      'SEC-5 package-lock.json has no integrity-hashed "packages" map',
    ]);
  });
});

describe('SEC-6 review gate', () => {
  it('needs a reason for every listed package', () => {
    expect(messages(reviewGateProblems({packages: {cbor: {}}}, PKG))).toEqual([
      'SEC-6 cbor is listed without a reason',
    ]);
  });

  it('needs a listed package that is installed to be pinned exactly', () => {
    const gated = {packages: {react: {reason: 'wallet interaction'}}};
    expect(reviewGateProblems(gated, PKG)).toEqual([]);
    expect(messages(reviewGateProblems(gated, {dependencies: {react: '^19.0.0'}}))).toEqual([
      'SEC-6 react is review-gated but "^19.0.0" is not exact',
    ]);
  });

  it('needs a listed package that is installed only transitively to become direct', () => {
    const gated = {packages: {cbor: {reason: 'CBOR encoding'}}};
    const lock = {lockfileVersion: 3, packages: {'node_modules/wallet/node_modules/cbor': {}}};
    expect(messages(reviewGateProblems(gated, PKG, lock))).toEqual([
      'SEC-6 cbor is installed but not a direct dependency, so package.json does not pin it',
    ]);
    expect(reviewGateProblems(gated, PKG, {lockfileVersion: 3, packages: {}})).toEqual([]);
  });

  it('rejects a list without a packages object', () => {
    expect(messages(reviewGateProblems({packages: []}, PKG))).toEqual([
      `SEC-6 ${REVIEW_GATED} has no "packages" object`,
    ]);
  });
});

describe('check:deps', () => {
  let root: string;
  const lines: string[] = [];
  const out = {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)};
  const write = (file: string, text: string) => fs.writeFile(path.join(root, file), text);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-deps-'));
    await fs.mkdir(path.join(root, 'config'));
    lines.length = 0;
    await write('package.json', JSON.stringify(PKG));
    await write('package-lock.json', JSON.stringify(LOCK));
    await write('.npmrc', NPMRC);
    await write(REVIEW_GATED, JSON.stringify({packages: {}}));
  });

  afterEach(async () => {
    await fs.rm(root, {recursive: true, force: true});
  });

  it('exits 0 on a pinned tree', async () => {
    expect(await main({root, out})).toBe(0);
  });

  it('exits 1 listing each violation', async () => {
    await write('package.json', JSON.stringify({dependencies: {react: '^19.0.0'}}));
    expect(await main({root, out})).toBe(1);
    expect(lines.join('\n')).toMatch(/SEC-5 {2}dependencies.react is "\^19.0.0"/);
  });

  it('cannot run on a malformed lockfile, rather than crashing', async () => {
    await write('package-lock.json', '{not json');
    expect(await main({root, out})).toBe(2);
    expect(lines.join('\n')).toMatch(/check:deps - cannot run/);
  });

  it('cannot run without the review-gated list', async () => {
    await fs.rm(path.join(root, REVIEW_GATED));
    expect(await main({root, out})).toBe(2);
  });
});
