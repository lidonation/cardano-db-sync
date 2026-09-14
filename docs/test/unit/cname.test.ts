import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PROFILES} from '../../config/profiles';
import cnamePlugin, {CNAME_FILE, emitCname} from '../../plugins/cname';
import type {LoadContext, Plugin} from '@docusaurus/types';

let outDir: string;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-cname-'));
});

afterEach(async () => {
  await fs.rm(outDir, {recursive: true, force: true});
});

async function readCname(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(outDir, CNAME_FILE), 'utf8');
  } catch {
    return null;
  }
}

describe('emitCname (ENV-6)', () => {
  it('writes the production host, newline-terminated, for the production profile', async () => {
    await emitCname(outDir, PROFILES.prod);
    expect(await readCname()).toBe('dbsync.cardano.intersect.org\n');
  });

  it('writes nothing for the developer profile', async () => {
    await emitCname(outDir, PROFILES.dev);
    expect(await readCname()).toBeNull();
  });

  it('removes a stray CNAME that reached the developer output', async () => {
    await fs.writeFile(path.join(outDir, CNAME_FILE), 'dbsync.cardano.intersect.org\n', 'utf8');
    await emitCname(outDir, PROFILES.dev);
    expect(await readCname()).toBeNull();
  });

  it('overwrites rather than appends when run twice', async () => {
    await emitCname(outDir, PROFILES.prod);
    await emitCname(outDir, PROFILES.prod);
    expect(await readCname()).toBe('dbsync.cardano.intersect.org\n');
  });

  it('is a no-op on the developer profile when no CNAME is present', async () => {
    await expect(emitCname(outDir, PROFILES.dev)).resolves.toBeUndefined();
  });
});

describe('cnamePlugin', () => {
  const context = {} as LoadContext;

  it('resolves its profile at plugin construction, from the environment', () => {
    const previous = process.env.DOCS_PROFILE;
    process.env.DOCS_PROFILE = 'prod';
    try {
      const plugin = cnamePlugin(context);
      expect(plugin.name).toBe('dbsync-cname');
    } finally {
      if (previous === undefined) {
        delete process.env.DOCS_PROFILE;
      } else {
        process.env.DOCS_PROFILE = previous;
      }
    }
  });

  it('emits through postBuild for production and not for dev', async () => {
    const previous = process.env.DOCS_PROFILE;

    try {
      process.env.DOCS_PROFILE = 'prod';
      const prodPlugin = cnamePlugin(context) as Plugin & {
        postBuild: (props: {outDir: string}) => Promise<void>;
      };
      await prodPlugin.postBuild({outDir});
      expect(await readCname()).toBe('dbsync.cardano.intersect.org\n');

      process.env.DOCS_PROFILE = 'dev';
      const devPlugin = cnamePlugin(context) as Plugin & {
        postBuild: (props: {outDir: string}) => Promise<void>;
      };
      await devPlugin.postBuild({outDir});
      expect(await readCname()).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.DOCS_PROFILE;
      } else {
        process.env.DOCS_PROFILE = previous;
      }
    }
  });

  it('refuses to construct when no profile is selected', () => {
    const previous = process.env.DOCS_PROFILE;
    delete process.env.DOCS_PROFILE;
    try {
      expect(() => cnamePlugin(context)).toThrow(/is not set/);
    } finally {
      if (previous !== undefined) {
        process.env.DOCS_PROFILE = previous;
      }
    }
  });
});
