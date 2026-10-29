import type {RoadmapData} from '../../src/roadmap/types';
const obj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const count = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const label = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 100;
export function parseCache(json: string): RoadmapData {
  const x: unknown = JSON.parse(json);
  if (
    !obj(x) ||
    x.version !== 1 ||
    typeof x.builtAt !== 'string' ||
    !Number.isFinite(Date.parse(x.builtAt)) ||
    !obj(x.statuses) ||
    !count(x.statuses.todo) ||
    !count(x.statuses.inProgress) ||
    !count(x.statuses.done) ||
    !Array.isArray(x.objectives) ||
    !Array.isArray(x.releases)
  )
    throw new Error('Invalid cache');
  const total = x.statuses.todo + x.statuses.inProgress + x.statuses.done;
  const objectives = x.objectives.map((o: unknown) => {
    if (
      !obj(o) ||
      !label(o.name) ||
      !count(o.done) ||
      !count(o.total) ||
      o.total === 0 ||
      o.done > o.total ||
      o.total > total
    )
      throw new Error('Invalid objective');
    return {name: o.name, done: o.done, total: o.total};
  });
  if (
    new Set(objectives.map((o) => o.name)).size !== objectives.length ||
    objectives.reduce((sum, o) => sum + o.total, 0) > total ||
    objectives.reduce((sum, o) => sum + o.done, 0) > x.statuses.done ||
    !x.releases.every(
      (release: unknown) => label(release) && /^\d+(?:\.\d+){1,3}$/.test(release),
    ) ||
    new Set(x.releases).size !== x.releases.length
  )
    throw new Error('Inconsistent cache');
  return {
    version: 1,
    builtAt: x.builtAt,
    statuses: {todo: x.statuses.todo, inProgress: x.statuses.inProgress, done: x.statuses.done},
    objectives,
    releases: x.releases,
  };
}
