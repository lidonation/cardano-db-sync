import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  ALLOWLIST,
  advisories,
  evaluate,
  main,
  parseAllowlist,
  runAudit,
} from '../../scripts/check-audit.mjs';

const via = (name: string, id: string, severity: string) => ({
  name,
  severity,
  title: `${name} problem`,
  range: '<9.9.9',
  url: `https://github.com/advisories/${id}`,
  source: 1,
});

/** `npm audit --json` shape: advisories hang off `via`; chains are bare names. */
const REPORT = {
  vulnerabilities: {
    tinypool: {severity: 'critical', via: [via('tinypool', 'GHSA-aaaa', 'critical')]},
    '@docusaurus/core': {severity: 'critical', via: ['tinypool']},
    uuid: {severity: 'moderate', via: [via('uuid', 'GHSA-cccc', 'moderate')]},
    lodash: {
      severity: 'high',
      via: [via('lodash', 'GHSA-bbbb', 'high'), via('lodash', 'GHSA-bbbb', 'high')],
    },
  },
};

const entry = (id: string, pkg: string, expires = '2027-01-01') => ({
  id,
  package: pkg,
  reason: 'reviewed: build-time only',
  expires,
});

describe('advisories', () => {
  it('collects each advisory once, from via objects only', () => {
    expect(
      advisories(REPORT).map((a: {id: string; package: string}) => `${a.id} ${a.package}`),
    ).toEqual(['GHSA-aaaa tinypool', 'GHSA-bbbb lodash', 'GHSA-cccc uuid']);
    expect(advisories({})).toEqual([]);
  });
});

describe('runAudit', () => {
  const report = JSON.stringify(REPORT);

  it('reads the report from a clean run', async () => {
    expect(await runAudit('/x', async () => ({stdout: report}))).toEqual(REPORT);
  });

  it('reads the report when npm exits 1 because it found something', async () => {
    const exec = async () => Promise.reject(Object.assign(new Error('exit 1'), {stdout: report}));
    expect(await runAudit('/x', exec)).toEqual(REPORT);
  });

  it("fails on npm's own error, and when npm could not run at all", async () => {
    const npmError = JSON.stringify({
      error: {code: 'ENOLOCK', summary: 'This command requires a lockfile'},
    });
    await expect(
      runAudit('/x', async () => Promise.reject(Object.assign(new Error('x'), {stdout: npmError}))),
    ).rejects.toThrow('npm audit failed: This command requires a lockfile');
    await expect(
      runAudit('/x', async () => Promise.reject(new Error('spawn npm ENOENT'))),
    ).rejects.toThrow('spawn npm ENOENT');
  });
});

describe('evaluate', () => {
  const found = advisories(REPORT);

  it('gates high and critical advisories that are not allowlisted', () => {
    const r = evaluate(found, [entry('GHSA-aaaa', 'tinypool')], '2026-10-11');
    expect(r.unreviewed.map((a: {id: string}) => a.id)).toEqual(['GHSA-bbbb']);
    expect(r.accepted.map((a: {id: string}) => a.id)).toEqual(['GHSA-aaaa']);
    expect(r.reported.map((a: {id: string}) => a.id)).toEqual(['GHSA-cccc']);
  });

  it('fails an expired exception, and one npm no longer reports', () => {
    const r = evaluate(
      found,
      [entry('GHSA-aaaa', 'tinypool', '2026-10-10'), entry('GHSA-gone', 'left-pad')],
      '2026-10-11',
    );
    expect(r.expired.map((e: {id: string}) => e.id)).toEqual(['GHSA-aaaa']);
    expect(r.stale.map((e: {id: string}) => e.id)).toEqual(['GHSA-gone']);
  });

  it('matches on advisory and package together', () => {
    const r = evaluate(found, [entry('GHSA-aaaa', 'other-package')], '2026-10-11');
    expect(r.unreviewed.map((a: {id: string}) => a.id)).toContain('GHSA-aaaa');
  });
});

describe('parseAllowlist', () => {
  it.each([
    [{}, /no "advisories" array/],
    [{advisories: [{id: 'x', package: 'p', expires: '2027-01-01'}]}, /needs a non-empty "reason"/],
    [{advisories: [{...entry('x', 'p'), expires: 'soon'}]}, /not YYYY-MM-DD/],
  ])('rejects %j', (list, message) => {
    expect(() => parseAllowlist(JSON.stringify(list))).toThrow(message);
  });
});

describe('check:audit', () => {
  let root: string;
  const lines: string[] = [];
  const out = {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)};

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-audit-'));
    await fs.mkdir(path.join(root, 'config'));
    lines.length = 0;
  });

  afterEach(async () => {
    await fs.rm(root, {recursive: true, force: true});
  });

  const allow = (list: unknown[]) =>
    fs.writeFile(path.join(root, ALLOWLIST), JSON.stringify({advisories: list}));

  it('exits 0 when every gated advisory is reviewed', async () => {
    await allow([entry('GHSA-aaaa', 'tinypool'), entry('GHSA-bbbb', 'lodash')]);
    expect(await main({root, out, today: '2026-10-11', report: REPORT})).toBe(0);
    expect(lines.join('\n')).toMatch(/1 advisory\(ies\) below high, not gated/);
  });

  it('says nothing about accepted or minor advisories when there are none', async () => {
    await allow([]);
    expect(await main({root, out, report: {}})).toBe(0);
    expect(lines).toEqual([
      'check:audit - clean. No unreviewed high or critical advisory (SEC-5).',
    ]);
  });

  it('exits 1 naming the unreviewed, expired and stale entries', async () => {
    await allow([entry('GHSA-aaaa', 'tinypool', '2026-01-01'), entry('GHSA-gone', 'x')]);
    expect(await main({root, out, today: '2026-10-11', report: REPORT})).toBe(1);
    const text = lines.join('\n');
    expect(text).toMatch(/GHSA-bbbb {2}lodash {2}high/);
    expect(text).toMatch(/GHSA-aaaa \(tinypool\) was accepted until 2026-01-01/);
    expect(text).toMatch(/GHSA-gone \(x\) is no longer reported/);
  });

  it('cannot run, rather than passing, without the allowlist or with a failed audit', async () => {
    expect(await main({root, out, report: REPORT})).toBe(2);
    await allow([]);
    expect(await main({root, out, report: undefined})).toBe(2);
    expect(lines.join('\n')).toMatch(/cannot run/);
  });
});
