import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {isRootBuild} from '../../config/i18n';
import {resolveProfile} from '../../config/profiles';
import type {UpdatesFeed} from '../../src/updates/types';
import {readUpdates} from './history';
import {atomFeed, rssFeed} from './xml';

// Docusaurus freshly imports plugins for each locale. Pin the snapshot on the build process,
// not the module cache, so every locale and both serializers see the same history.
const SNAPSHOTS = Symbol.for('dbsync.updates.snapshots');
const processCache = globalThis as typeof globalThis & {
  [SNAPSHOTS]?: Map<string, UpdatesFeed>;
};
const snapshots = (processCache[SNAPSHOTS] ??= new Map<string, UpdatesFeed>());

export default function updatesPlugin(context: LoadContext): Plugin {
  const profile = resolveProfile();
  const repo = path.resolve(process.env.UPDATES_CHECKOUT || path.join(context.siteDir, '..'));
  let feed: UpdatesFeed;
  return {
    name: 'updates',
    async contentLoaded({actions: {createData}}) {
      let snapshot = snapshots.get(repo);
      if (!snapshot) {
        snapshot = readUpdates(repo);
        snapshots.set(repo, snapshot);
      }
      feed = snapshot;
      await createData('feed.json', JSON.stringify(feed));
    },
    async postBuild({outDir}) {
      if (!isRootBuild(context)) return;
      const directory = path.join(outDir, 'updates');
      await mkdir(directory, {recursive: true});
      await Promise.all([
        writeFile(path.join(directory, 'rss.xml'), rssFeed(feed, profile)),
        writeFile(path.join(directory, 'atom.xml'), atomFeed(feed, profile)),
      ]);
    },
  };
}
