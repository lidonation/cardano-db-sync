import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  SOURCES,
  externalUrls,
  linkConstants,
  main,
  status,
} from '../../scripts/check-external-links.mjs';
import {loadReleaseHistory, releaseHistory} from '../../src/data/release-history';
import {teams, tools} from '../../src/ecosystem/entries';
import {ECOSYSTEM_IDS} from '../../src/ecosystem/ids';

import {runAsScript} from './run-as-script';

const DOCS = path.resolve(import.meta.dirname, '../..');
const english = ({message}: {message: string}) => message;
const noWait = async () => {};
const quiet = {log: () => {}, error: () => {}};

/** A fetch that answers each URL from a list of statuses, one per call. */
function fakeFetch(answers: Record<string, (number | Error)[]>) {
  const calls: string[] = [];
  const http = (async (url: string, init: {method: string}) => {
    calls.push(`${init.method} ${url}`);
    const next = answers[url].shift();
    if (next instanceof Error || next === undefined) throw next ?? new Error('no answer');
    return {ok: next >= 200 && next < 300, status: next};
  }) as unknown as typeof fetch;
  return {http, calls};
}

describe('release history (B44-b)', () => {
  it('counts the committed changelog', () => {
    const history = loadReleaseHistory(path.join(DOCS, '../cardano-db-sync/CHANGELOG.md'));
    expect(history.releases).toBeGreaterThan(50);
    expect(history.latest).toMatch(/^13\.\d+\.\d+/);
    expect(history.since).toBe(2019);
  });

  it('counts released headings only, newest first, oldest dated year', () => {
    const changelog = [
      '# Revision history',
      '## Unreleased',
      '## 2.1.0',
      '- fix',
      '## 2.0.0 -- March 2021',
      '## 1.0.0 -- November 2019',
      '### 1.0.0 notes',
    ].join('\n');
    expect(releaseHistory(changelog)).toEqual({releases: 3, latest: '2.1.0', since: 2019});
  });

  it('refuses a changelog with no dated release', () => {
    expect(() => releaseHistory('## Unreleased\n## 1.0.0')).toThrow(/no dated release/);
    expect(() => releaseHistory('')).toThrow(/no dated release/);
  });
});

describe('ecosystem entries', () => {
  it('names every tool and team once, each with an https link', () => {
    const entries = [...tools(english), ...teams(english)];
    expect(new Set(tools(english).map((tool) => tool.name)).size).toBe(tools(english).length);
    expect(new Set(teams(english).map((team) => team.name)).size).toBe(teams(english).length);
    for (const entry of entries) expect(entry.url, entry.name).toMatch(/^https:\/\//);
  });

  it('every link the page renders is one the external link check fetches', async () => {
    const constants = await linkConstants();
    const checked = new Set(
      SOURCES.flatMap((file: string) =>
        externalUrls(readFileSync(path.join(DOCS, file), 'utf8'), constants),
      ),
    );
    for (const entry of [...tools(english), ...teams(english)]) {
      expect(checked.has(entry.url), entry.url).toBe(true);
    }
  });

  it('lists exactly the string ids the page renders (A11Y-18)', () => {
    const dir = path.join(DOCS, 'src/ecosystem');
    const source = [
      ...readdirSync(dir).map((file) => readFileSync(path.join(dir, file), 'utf8')),
      readFileSync(path.join(DOCS, 'src/pages/ecosystem.tsx'), 'utf8'),
    ].join('\n');
    const used = new Set(
      [...source.matchAll(/id: '(ecosystem\.[^']+)'/g)].map((match) => match[1]),
    );
    expect([...ECOSYSTEM_IDS].sort()).toEqual([...used].sort());
  });
});

describe('check:external-links', () => {
  it('finds literal and constant-interpolated https URLs, never an unresolved template', () => {
    const text = [
      "url: 'https://a.example/x',",
      "other: 'http://insecure.example',",
      'url: `${REPO_URL}/issues/1`,',
      'url: `${UNKNOWN}/y`,',
      'label: `${count} items`,',
    ].join('\n');
    expect(externalUrls(text, {REPO_URL: 'https://github.com/o/r'})).toEqual([
      'https://a.example/x',
      'https://github.com/o/r/issues/1',
    ]);
  });

  it('accepts a HEAD answer, and falls back to GET where HEAD is refused', async () => {
    const ok = fakeFetch({u: [200]});
    expect(await status('u', ok.http, noWait)).toBe(200);
    const refused = fakeFetch({u: [405, 200]});
    expect(await status('u', refused.http, noWait)).toBe(200);
    expect(refused.calls).toEqual(['HEAD u', 'GET u']);
  });

  it('reports a 404 at once, and retries a 5xx or a network error once', async () => {
    const missing = fakeFetch({u: [404]});
    expect(await status('u', missing.http, noWait)).toBe(404);
    expect(missing.calls).toHaveLength(1);
    const flaky = fakeFetch({u: [503, 200]});
    expect(await status('u', flaky.http, noWait)).toBe(200);
    const down = fakeFetch({u: [new Error('reset'), new Error('reset')]});
    expect(await status('u', down.http, noWait)).toBe(0);
    expect(down.calls).toHaveLength(2);
  });

  it('fails on a broken link, warns on rate limiting, passes when all resolve', async () => {
    const file = path.join(DOCS, 'src/ecosystem/entries.ts');
    const urls = externalUrls(readFileSync(file, 'utf8'), await linkConstants());
    const answers = (code: number) => Object.fromEntries(urls.map((url) => [url, [code, code]]));
    const errors: string[] = [];
    const out = {log: () => {}, error: (line: string) => errors.push(line)};

    const broken = fakeFetch({...answers(200), [urls[0]]: [404]});
    expect(await main([file], {http: broken.http, wait: noWait, out})).toBe(1);
    expect(errors.join('\n')).toContain(`404  ${urls[0]}`);

    const limited = fakeFetch({...answers(200), [urls[0]]: [429, 429, 429, 429]});
    expect(await main([file], {http: limited.http, wait: noWait, out: quiet})).toBe(0);

    expect(await main([file], {http: fakeFetch(answers(200)).http, wait: noWait, out: quiet})).toBe(
      0,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits five seconds before its one retry', async () => {
    vi.useFakeTimers();
    const flaky = fakeFetch({u: [503, 200]});
    const pending = status('u', flaky.http);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(flaky.calls).toEqual(['HEAD u']);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(200);
  });

  it('runs from the command line over the Ecosystem sources', async () => {
    vi.stubGlobal('fetch', fakeFetch(new Proxy({}, {get: () => [200]})).http);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runAsScript('../../scripts/check-external-links.mjs', [])).toBe(0);
  });
});
