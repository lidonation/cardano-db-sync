import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {SIZE_LIMIT, TIME_LIMIT, main, treeSize} from '../../scripts/check-publish.mjs';
import {runAsScript} from './run-as-script';

let dir: string;
const lines: string[] = [];
const out = {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-publish-'));
  lines.length = 0;
  await fs.mkdir(path.join(dir, 'ja', 'assets'), {recursive: true});
  await fs.writeFile(path.join(dir, 'index.html'), 'x'.repeat(600));
  await fs.writeFile(path.join(dir, 'ja', 'assets', 'a.js'), 'y'.repeat(400));
});

afterEach(async () => {
  await fs.rm(dir, {recursive: true, force: true});
});

describe('BLD-1 limits', () => {
  it('are the Pages limits: 1 GB published, 10 minutes per deploy', () => {
    expect(SIZE_LIMIT).toBe(1_000_000_000);
    expect(TIME_LIMIT).toBe(600);
  });
});

describe('size', () => {
  it('totals every file, every locale included', async () => {
    expect(await treeSize(dir)).toBe(1000);
  });

  it('passes under the limit and reports how close it is', async () => {
    expect(await main(['size', dir], {out, limits: {size: 4000, time: 600}})).toBe(0);
    expect(lines).toEqual(['check:publish - published tree 0.0 MB of 0.0 MB (25.0%) (BLD-1)']);
  });

  it('fails over the limit', async () => {
    expect(await main(['size', dir], {out, limits: {size: 999, time: 600}})).toBe(1);
    expect(lines[0]).toMatch(/over the Pages limit/);
  });

  it('cannot measure a missing tree', async () => {
    expect(await main(['size', path.join(dir, 'none')], {out})).toBe(2);
  });
});

describe('elapsed', () => {
  it('passes inside the timeout and fails past it', async () => {
    expect(await main(['elapsed', '1000'], {out, now: 1599})).toBe(0);
    expect(lines.at(-1)).toBe('check:publish - deploy took 599s of 600s (BLD-1)');
    expect(await main(['elapsed', '1000'], {out, now: 1601})).toBe(1);
    expect(lines.at(-1)).toMatch(/over the Pages deploy timeout: deploy took 601s/);
  });
});

it('explains its usage on bad arguments', async () => {
  for (const args of [[], ['elapsed'], ['elapsed', 'soon'], ['size']]) {
    expect(await main(args, {out})).toBe(2);
  }
  expect(lines.at(-1)).toMatch(/^usage:/);
});

it('runs as a command, setting the exit code', async () => {
  const now = String(Math.floor(Date.now() / 1000));
  expect(await runAsScript('../../scripts/check-publish.mjs', ['elapsed', now])).toBe(0);
});
