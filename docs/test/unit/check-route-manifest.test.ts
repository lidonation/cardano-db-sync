import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {findDeleted, main} from '../../scripts/check-route-manifest.mjs';

const git = promisify(execFile);

let root: string;

function recorder() {
  const lines: string[] = [];
  return {lines, out: {log: (m: string) => lines.push(m), error: (m: string) => lines.push(m)}};
}

async function writeRoutes(routes: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.join(root, 'config'), {recursive: true});
  await fs.writeFile(path.join(root, 'config', 'route-manifest.json'), JSON.stringify({routes}));
}

async function commit(message: string): Promise<void> {
  await git('git', ['add', '-A'], {cwd: root});
  await git('git', ['commit', '-q', '--allow-empty', '-m', message], {cwd: root});
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-manifest-gate-'));
  await git('git', ['init', '-q'], {cwd: root});
  await git('git', ['config', 'user.email', 'test@example.com'], {cwd: root});
  await git('git', ['config', 'user.name', 'test'], {cwd: root});
});

afterEach(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

describe('findDeleted', () => {
  it('lists base routes missing now, sorted, and ignores additions and status changes', () => {
    expect(
      findDeleted({'/b': {}, '/a': {}, '/c': {}}, {'/c': {status: 'retired'}, '/new': {}}),
    ).toEqual(['/a', '/b']);
  });
});

describe('check:manifest gate (VER-5 append-only)', () => {
  const live = {status: 'live'};

  it('passes when every base route is still listed', async () => {
    await writeRoutes({'/': live});
    await commit('base');
    await writeRoutes({'/': {status: 'retired', redirect: '/'}, '/new': live});
    const {lines, out} = recorder();
    expect(await main({root, env: {}, out})).toBe(0);
    expect(lines.join('\n')).toMatch(/append-only holds: all 1 route/);
  });

  it('fails listing the deleted entries', async () => {
    await writeRoutes({'/': live, '/docs/a': live, '/docs/b': live});
    await commit('base');
    await writeRoutes({'/': live});
    const {lines, out} = recorder();
    expect(await main({root, env: {}, out})).toBe(1);
    expect(lines).toContain('  /docs/a');
    expect(lines).toContain('  /docs/b');
  });

  it('lists every base route when the manifest file itself was deleted', async () => {
    await writeRoutes({'/': live, '/docs/a': live});
    await commit('base');
    await fs.rm(path.join(root, 'config', 'route-manifest.json'));
    const {lines, out} = recorder();
    expect(await main({root, env: {}, out})).toBe(1);
    expect(lines).toContain('  /');
    expect(lines).toContain('  /docs/a');
  });

  it('compares against MANIFEST_BASE_REF when set', async () => {
    await writeRoutes({'/': live, '/old': live});
    await commit('base');
    const {stdout} = await git('git', ['rev-parse', 'HEAD'], {cwd: root});
    await writeRoutes({'/': live});
    await commit('deletes /old');
    const {lines, out} = recorder();
    expect(await main({root, env: {MANIFEST_BASE_REF: stdout.trim()}, out})).toBe(1);
    expect(lines).toContain('  /old');
  });

  it('passes when the base has no manifest yet', async () => {
    await commit('empty base');
    await writeRoutes({'/': live});
    const {lines, out} = recorder();
    expect(await main({root, env: {}, out})).toBe(0);
    expect(lines.join('\n')).toMatch(/is new since HEAD/);
  });

  it('passes when there is no base commit (a new branch push)', async () => {
    const {out} = recorder();
    expect(await main({root, env: {MANIFEST_BASE_REF: '0'.repeat(40)}, out})).toBe(0);
  });

  it('cannot run, rather than passing, when the base ref does not resolve', async () => {
    await writeRoutes({'/': live});
    await commit('base');
    const {lines, out} = recorder();
    expect(await main({root, env: {MANIFEST_BASE_REF: 'no-such-ref'}, out})).toBe(2);
    expect(lines.join('\n')).toMatch(/does not resolve to a commit/);
  });
});
