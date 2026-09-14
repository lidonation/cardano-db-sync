import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {findViolations, main} from '../../scripts/check-baseurl.mjs';

const DOCS_ROOT = path.resolve(import.meta.dirname, '../..');

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-gate-'));
  await fs.mkdir(path.join(root, 'config'), {recursive: true});
  await fs.mkdir(path.join(root, 'src'), {recursive: true});
});

afterEach(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

describe('check:baseurl gate (ENV-1)', () => {
  it('passes over the real docs tree', async () => {
    const violations = await findViolations(DOCS_ROOT);
    expect(violations).toEqual([]);
  });

  it('flags a hardcoded developer baseUrl in source', async () => {
    await fs.writeFile(path.join(root, 'src', 'Nav.tsx'), "const to = '/cardano-db-sync/docs';\n");
    const violations = await findViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('dev-baseurl');
    expect(violations[0].file).toBe('src/Nav.tsx');
    expect(violations[0].line).toBe(1);
  });

  it('flags a hardcoded production host', async () => {
    await fs.writeFile(
      path.join(root, 'src', 'meta.ts'),
      "export const canonical = 'https://dbsync.cardano.intersect.org/docs';\n",
    );
    const violations = await findViolations(root);
    expect(violations.map((v) => v.rule)).toContain('prod-host');
  });

  it('flags baseUrl assigned a string literal', async () => {
    await fs.writeFile(path.join(root, 'src', 'other.ts'), "const c = {baseUrl: '/somewhere/'};\n");
    const violations = await findViolations(root);
    expect(violations.map((v) => v.rule)).toContain('baseurl-literal');
  });

  it('allows the literals inside the profile module', async () => {
    await fs.writeFile(
      path.join(root, 'config', 'profiles.ts'),
      "export const baseUrl = '/cardano-db-sync/';\n",
    );
    expect(await findViolations(root)).toEqual([]);
  });

  it('allows the literals inside tests, which are not shipped source', async () => {
    await fs.mkdir(path.join(root, 'test'), {recursive: true});
    await fs.writeFile(
      path.join(root, 'test', 'a.test.ts'),
      "expect(b).toBe('/cardano-db-sync/');",
    );
    expect(await findViolations(root)).toEqual([]);
  });

  it('skips build output and dependencies', async () => {
    for (const dir of ['build', 'node_modules', '.docusaurus']) {
      await fs.mkdir(path.join(root, dir), {recursive: true});
      await fs.writeFile(path.join(root, dir, 'index.js'), "var u = '/cardano-db-sync/';");
    }
    expect(await findViolations(root)).toEqual([]);
  });

  it('scans authored markdown too', async () => {
    await fs.mkdir(path.join(root, 'docs'), {recursive: true});
    await fs.writeFile(path.join(root, 'docs', 'page.md'), 'See [here](/cardano-db-sync/docs).\n');
    expect(await findViolations(root)).toHaveLength(1);
  });

  it('does not flag a GitHub repository URL, which legitimately contains the repo name', async () => {
    await fs.mkdir(path.join(root, 'docs'), {recursive: true});
    await fs.writeFile(
      path.join(root, 'docs', 'links.md'),
      'See [running.md](https://github.com/IntersectMBO/cardano-db-sync/blob/master/doc/running.md).\n',
    );
    expect(await findViolations(root)).toEqual([]);
  });

  it('still flags a real baseUrl on a line that also holds a GitHub URL', async () => {
    await fs.writeFile(
      path.join(root, 'src', 'mixed.ts'),
      "const repo = 'https://github.com/IntersectMBO/cardano-db-sync'; const to = '/cardano-db-sync/docs';\n",
    );
    expect(await findViolations(root)).toHaveLength(1);
  });

  it('ignores file types it cannot reason about', async () => {
    await fs.writeFile(path.join(root, 'notes.txt'), '/cardano-db-sync/');
    expect(await findViolations(root)).toEqual([]);
  });

  it('reports every offending line, not just the first', async () => {
    await fs.writeFile(
      path.join(root, 'src', 'two.ts'),
      "const a = '/cardano-db-sync/';\nconst b = 'https://dbsync.cardano.intersect.org';\n",
    );
    const violations = await findViolations(root);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.line)).toEqual([1, 2]);
  });
});

describe('check:baseurl CLI reporting', () => {
  function recorder() {
    const lines: string[] = [];
    return {
      lines,
      log: (msg: string) => lines.push(msg),
      error: (msg: string) => lines.push(msg),
    };
  }

  it('exits 0 and says so when the tree is clean', async () => {
    const out = recorder();
    const code = await main(root, out);
    expect(code).toBe(0);
    expect(out.lines.join('\n')).toContain('clean');
  });

  it('exits 1 and names the offending file and line', async () => {
    await fs.writeFile(path.join(root, 'src', 'bad.ts'), "const u = '/cardano-db-sync/';\n");
    const out = recorder();
    const code = await main(root, out);
    expect(code).toBe(1);
    const report = out.lines.join('\n');
    expect(report).toContain('1 violation(s) of ENV-1');
    expect(report).toContain('src/bad.ts:1');
    expect(report).toContain('config/profiles.ts');
  });

  it('exits 0 over the real docs tree', async () => {
    const out = recorder();
    expect(await main(DOCS_ROOT, out)).toBe(0);
  });
});
