import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import {beforeAll, describe, expect, it} from 'vitest';

import {PROFILES} from '../../config/profiles';

const run = promisify(execFile);
const DOCS_ROOT = path.resolve(import.meta.dirname, '../..');

const OUT = {
  dev: path.join(DOCS_ROOT, 'build', 'dev'),
  prod: path.join(DOCS_ROOT, 'build', 'prod'),
};

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * B01 DoD: both profiles build clean from one working tree. The two builds run back to back in
 * the same checkout, which is the case that catches a profile value leaking through a cache.
 */
beforeAll(async () => {
  await fs.rm(path.join(DOCS_ROOT, 'build'), {recursive: true, force: true});
  await run('npm', ['run', 'build:dev'], {cwd: DOCS_ROOT, maxBuffer: 64 * 1024 * 1024});
  await run('npm', ['run', 'build:prod'], {cwd: DOCS_ROOT, maxBuffer: 64 * 1024 * 1024});
}, 900_000);

describe('both profiles build from one working tree', () => {
  it('emits an index page for each profile', async () => {
    expect(await exists(path.join(OUT.dev, 'index.html'))).toBe(true);
    expect(await exists(path.join(OUT.prod, 'index.html'))).toBe(true);
  });

  it('emits the seed docs page under each profile', async () => {
    expect(await exists(path.join(OUT.dev, 'docs', 'intro', 'index.html'))).toBe(true);
    expect(await exists(path.join(OUT.prod, 'docs', 'intro', 'index.html'))).toBe(true);
  });
});

describe('CNAME is a production-only artifact (ENV-6)', () => {
  it('does not write a CNAME into the developer output', async () => {
    expect(await exists(path.join(OUT.dev, 'CNAME'))).toBe(false);
  });

  it('writes the production host into the production output', async () => {
    const contents = await fs.readFile(path.join(OUT.prod, 'CNAME'), 'utf8');
    expect(contents.trim()).toBe(PROFILES.prod.cname);
  });
});

describe('baseUrl reaches the emitted HTML (ENV-1)', () => {
  it('prefixes developer asset paths with the subpath', async () => {
    const html = await fs.readFile(path.join(OUT.dev, 'index.html'), 'utf8');
    expect(html).toMatch(/(href|src)="\/cardano-db-sync\/assets\//);
  });

  it('serves production asset paths from the root', async () => {
    const html = await fs.readFile(path.join(OUT.prod, 'index.html'), 'utf8');
    expect(html).toMatch(/(href|src)="\/assets\//);
    expect(html).not.toMatch(/\/cardano-db-sync\/assets\//);
  });

  it('keeps the developer subpath out of the production output entirely', async () => {
    const html = await fs.readFile(path.join(OUT.prod, 'docs', 'intro', 'index.html'), 'utf8');
    expect(html).not.toContain('/cardano-db-sync/assets/');
  });
});

describe('the build carries no secrets and needs none (ENV-5)', () => {
  it('builds with an environment that has only the profile variable set', async () => {
    const {stdout} = await run('npm', ['run', 'build:dev'], {
      cwd: DOCS_ROOT,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        DOCS_PROFILE: 'dev',
      },
    });
    expect(stdout).toContain('Generated static files');
  }, 900_000);
});
