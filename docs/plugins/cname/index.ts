import fs from 'node:fs/promises';
import path from 'node:path';

import type {LoadContext, Plugin} from '@docusaurus/types';

import {resolveProfile, type BuildProfile} from '../../config/profiles';
import {isRootBuild} from '../environment';

export const CNAME_FILE = 'CNAME';

/**
 * Writes the GitHub Pages `CNAME` file from the active build profile (ENV-6).
 *
 * Production emits it; the developer profile emits nothing and actively removes a stray one, so a
 * `CNAME` that reaches `static/` by accident cannot send the fork's site to production's host.
 */
export async function emitCname(outDir: string, profile: BuildProfile): Promise<void> {
  const target = path.join(outDir, CNAME_FILE);

  if (profile.cname === null) {
    await fs.rm(target, {force: true});
    return;
  }

  await fs.writeFile(target, `${profile.cname}\n`, 'utf8');
}

export default function cnamePlugin(context: LoadContext): Plugin {
  const profile = resolveProfile();

  return {
    name: 'dbsync-cname',
    async postBuild({outDir}) {
      // CNAME belongs at the site root, which only the default locale's build writes.
      if (isRootBuild(context)) {
        await emitCname(outDir, profile);
      }
    },
  };
}
