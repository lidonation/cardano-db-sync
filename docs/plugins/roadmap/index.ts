import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';
import type {RoadmapState} from '../../src/roadmap/types';
import {parseCache} from './cache';
import {resolveRoadmap} from './data';
import {readRoadmap} from './source';

const snapshots = new Map<string, Promise<RoadmapState>>();
export default function roadmap(context: LoadContext): Plugin {
  const cacheDir = path.resolve(
    process.env.ROADMAP_CACHE || path.join(context.siteDir, '.cache/roadmap'),
  );
  const cacheFile = path.join(cacheDir, 'data.json');
  return {
    name: 'roadmap',
    async contentLoaded({actions: {createData}}) {
      let snapshot = snapshots.get(cacheDir);
      if (!snapshot) {
        snapshot = resolveRoadmap(
          async () => {
            if (process.env.ROADMAP_OFFLINE === '1') throw new Error('Roadmap source disabled');
            const data = parseCache(JSON.stringify(await readRoadmap()));
            try {
              await mkdir(cacheDir, {recursive: true});
              await writeFile(`${cacheFile}.tmp`, JSON.stringify(data));
              await rename(`${cacheFile}.tmp`, cacheFile);
            } catch {
              console.warn('roadmap: could not save cache');
            }
            return data;
          },
          async () => parseCache(await readFile(cacheFile, 'utf8')),
        );
        snapshots.set(cacheDir, snapshot);
      }
      const state = await snapshot;
      if (state.status === 'unavailable') console.warn('roadmap: data unavailable');
      await createData('resolved.json', JSON.stringify(state));
    },
  };
}
