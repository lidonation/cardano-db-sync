import {copyFile, lstat, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';
import type {RepositorySnapshotState} from '../../src/repository-activity/types';
import {downloadAvatar, pruneAvatars} from './avatars';
import {parseCache} from './cache';
import {enrichHistory, resolveActivity, summarizeActivity} from './data';
import {readProfiles} from './github';
import {readHistory} from './git';
import {CORE_TEAM} from '../../src/ecosystem/entries';

// Docusaurus builds each locale in the same process; fetch once so all locales share a snapshot.
const snapshots = new Map<string, Promise<RepositorySnapshotState>>();

export default function repositoryActivity(context: LoadContext): Plugin {
  const cacheDir = path.resolve(
    process.env.REPOSITORY_ACTIVITY_CACHE ||
      path.join(context.siteDir, '.cache/repository-activity'),
  );
  const avatarsDir = path.join(cacheDir, 'avatars');
  const cacheFile = path.join(cacheDir, 'data.json');
  let avatarNames: string[] = [];
  return {
    name: 'repository-activity',
    async contentLoaded({actions: {createData}}) {
      const key = `${cacheDir}\0${process.env.REPOSITORY_CHECKOUT ?? ''}\0${Boolean(process.env.GITHUB_TOKEN)}`;
      let snapshot = snapshots.get(key);
      if (!snapshot) {
        snapshot = resolveActivity(
          async () => {
            const checkout = process.env.REPOSITORY_CHECKOUT;
            const token = process.env.GITHUB_TOKEN;
            if (!checkout || !token)
              throw new Error('Repository checkout or GitHub token unavailable');
            const history = readHistory(checkout);
            const profiles = await readProfiles(
              history.authors.map((author) => author.sha),
              token,
              fetch,
              CORE_TEAM.map((entry) => entry.login),
            );
            const data = await enrichHistory(
              history,
              profiles.slice(0, history.authors.length),
              new Date().toISOString(),
              (profile) => downloadAvatar(profile, avatarsDir),
              profiles.slice(history.authors.length),
            );
            // Validate the exact public artifact before it is cached or sent to webpack.
            const validated = parseCache(JSON.stringify(data));
            try {
              await mkdir(cacheDir, {recursive: true});
              await writeFile(`${cacheFile}.tmp`, JSON.stringify(validated));
              await rename(`${cacheFile}.tmp`, cacheFile);
              await pruneAvatars(
                avatarsDir,
                [...validated.contributors, ...validated.coreTeam].flatMap((person) =>
                  person.avatar ? [person.avatar] : [],
                ),
              );
            } catch {
              console.warn('repository-activity: could not save cache');
            }
            return validated;
          },
          async () => parseCache(await readFile(cacheFile, 'utf8')),
        );
        snapshots.set(key, snapshot);
      }
      const state = await snapshot;
      if (state.status === 'available') {
        avatarNames = [
          ...new Set(
            [...state.data.contributors, ...state.data.coreTeam].flatMap((person) =>
              person.avatar ? [path.basename(person.avatar)] : [],
            ),
          ),
        ];
      } else console.warn('repository-activity: data unavailable');
      await createData('resolved.json', JSON.stringify(summarizeActivity(state)));
      await createData('history.json', JSON.stringify(state));
    },
    async postBuild({outDir}) {
      // Never publish the cache directory wholesale: only validated, referenced raster names.
      await Promise.all(
        avatarNames.map(async (name) => {
          try {
            const source = path.join(avatarsDir, name);
            if (!(await lstat(source)).isFile()) return;
            const destination = path.join(outDir, 'repository-avatars');
            await mkdir(destination, {recursive: true});
            await copyFile(source, path.join(destination, name));
          } catch {
            /* Missing avatars degrade to initials independently of other images. */
          }
        }),
      );
    },
  };
}
