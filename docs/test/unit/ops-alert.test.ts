import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {LABEL, alertTitle, main, report} from '../../scripts/ops-alert.mjs';

/** Import the script as `node` would run it, so its command-line entry point executes. */
async function runAsScript(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const argv = process.argv;
  const saved = {...process.env};
  process.argv = [argv[0], fileURLToPath(new URL(script, import.meta.url)), ...args];
  Object.assign(process.env, env);
  try {
    const specifier = `${script}?cli=${Math.random()}`;
    await import(/* @vite-ignore */ specifier);
    return process.exitCode;
  } finally {
    process.argv = argv;
    process.env = saved;
    process.exitCode = undefined;
  }
}

interface Call {
  method: string;
  route: string;
  body?: Record<string, unknown>;
}

/** A fake GitHub API holding open issues; records every call. */
function github(open: {number: number; title: string}[] = [], fail: Record<string, number> = {}) {
  const calls: Call[] = [];
  const http = async (url: string, init: {method: string; body?: string}) => {
    const route = url.replace('https://api.example/repos/o/r', '');
    calls.push({method: init.method, route, body: init.body ? JSON.parse(init.body) : undefined});
    const status =
      fail[`${init.method} ${route.split('?')[0]}`] ?? (init.method === 'POST' ? 201 : 200);
    return {
      ok: status < 300,
      status,
      json: async () => open,
      text: async () => 'nope',
    } as unknown as Response;
  };
  return {calls, http: http as unknown as typeof fetch};
}

const input = (result: string) => ({
  result,
  workflow: 'Documentation translations',
  runUrl: 'https://github.example/o/r/actions/runs/7',
  repository: 'o/r',
  apiUrl: 'https://api.example',
  token: 't',
  now: '2026-10-11T04:00:00Z',
});

const TITLE = alertTitle('Documentation translations');

describe('report (NUM-4)', () => {
  it('opens a labelled alert on the first failure, creating the label', async () => {
    const {calls, http} = github();
    expect(await report(input('failure'), http)).toBe('opened');
    expect(calls.map((c) => `${c.method} ${c.route}`)).toEqual([
      `GET /issues?labels=${LABEL}&state=open&per_page=100`,
      'POST /labels',
      'POST /issues',
    ]);
    expect(calls[2].body).toMatchObject({title: TITLE, labels: [LABEL]});
    expect(String(calls[2].body?.body)).toContain(
      'https://github.example/o/r/actions/runs/7 ended **failure**',
    );
  });

  it('carries on when the label already exists', async () => {
    const {calls, http} = github([], {'POST /labels': 422});
    expect(await report(input('failure'), http)).toBe('opened');
    expect(calls.at(-1)?.route).toBe('/issues');
  });

  it('comments on the open alert for a repeated failure or a cancellation', async () => {
    const {calls, http} = github([
      {number: 12, title: TITLE},
      {number: 3, title: 'other'},
    ]);
    expect(await report(input('cancelled'), http)).toBe('commented');
    expect(calls.at(-1)).toMatchObject({method: 'POST', route: '/issues/12/comments'});
    expect(String(calls.at(-1)?.body?.body)).toMatch(/^Still failing\. .* ended \*\*cancelled\*\*/);
  });

  it('closes the open alert when the job recovers', async () => {
    const {calls, http} = github([{number: 12, title: TITLE}]);
    expect(await report(input('success'), http)).toBe('closed');
    expect(calls.slice(1).map((c) => `${c.method} ${c.route}`)).toEqual([
      'POST /issues/12/comments',
      'PATCH /issues/12',
    ]);
    expect(calls.at(-1)?.body).toEqual({state: 'closed', state_reason: 'completed'});
  });

  it('does nothing on a success with no alert open, or on a skipped job', async () => {
    const quiet = github();
    expect(await report(input('success'), quiet.http)).toBe('none');
    expect(quiet.calls).toHaveLength(1);
    const skipped = github();
    expect(await report(input('skipped'), skipped.http)).toBe('none');
    expect(skipped.calls).toHaveLength(0);
  });

  it('throws when the API refuses, naming the step', async () => {
    const {http} = github([], {'POST /labels': 403});
    await expect(report(input('failure'), http)).rejects.toThrow(/creating the label: HTTP 403/);
  });
});

describe('ops-alert CLI', () => {
  const env = {
    OPS_RESULT: 'failure',
    GITHUB_WORKFLOW: 'Docs ops alert drill',
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_TOKEN: 't',
    GITHUB_RUN_ID: '7',
    GITHUB_API_URL: 'https://api.example',
  };
  const recorder = () => {
    const lines: string[] = [];
    return {lines, out: {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)}};
  };

  it('reports what it did, linking the run on github.com by default', async () => {
    const {calls, http} = github();
    const {lines, out} = recorder();
    expect(await main({env, out, http, now: 'now'})).toBe(0);
    expect(lines).toEqual(['ops-alert - Docs ops alert drill: failure -> opened']);
    expect(String(calls.at(-1)?.body?.body)).toContain('https://github.com/o/r/actions/runs/7');
  });

  it('exits 1, red in the run, when the alert cannot be raised', async () => {
    const {http} = github([], {'GET /issues': 500});
    const {lines, out} = recorder();
    expect(await main({env, out, http})).toBe(1);
    expect(lines.join('\n')).toMatch(/could not raise the alert: listing open alerts: HTTP 500/);
  });

  it('defaults to the public API, and reports a failure that is not an Error', async () => {
    const urls: string[] = [];
    const http = (async (url: string) => {
      urls.push(url);
      throw 'socket hang up';
    }) as unknown as typeof fetch;
    const {lines, out} = recorder();
    const {GITHUB_API_URL: _api, ...rest} = env;
    expect(await main({env: rest, out, http})).toBe(1);
    expect(urls[0]).toMatch(/^https:\/\/api\.github\.com\/repos\/o\/r\/issues/);
    expect(lines).toEqual(['ops-alert - could not raise the alert: socket hang up']);
  });

  it('exits 2 naming what is missing', async () => {
    const {lines, out} = recorder();
    expect(await main({env: {OPS_RESULT: 'failure'}, out})).toBe(2);
    expect(lines.join('\n')).toBe(
      'ops-alert - missing GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_RUN_ID, OPS_WORKFLOW',
    );
  });
});

it('runs as a command, setting the exit code', async () => {
  const env = {OPS_RESULT: '', GITHUB_REPOSITORY: '', GITHUB_TOKEN: '', GITHUB_RUN_ID: ''};
  expect(await runAsScript('../../scripts/ops-alert.mjs', [], env)).toBe(2);
});
