import type {RoadmapData, RoadmapState} from '../../src/roadmap/types';

type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

/** Fail closed on unfamiliar fields, options, pages or items: partial totals are misleading. */
export function transform(fields: unknown, pages: unknown, builtAt: string): RoadmapData {
  if (
    !Array.isArray(fields) ||
    !Array.isArray(pages) ||
    !pages.length ||
    !Number.isFinite(Date.parse(builtAt))
  )
    throw new Error('Invalid source');
  const wanted = ['Status', 'Performance', 'Release Planned'] as const;
  const defs = new Map<string, {id: string; options: Map<string, string>}>();
  for (const name of wanted) {
    const matches = fields.filter((f: unknown) => object(f) && f.name === name);
    if (matches.length !== 1 || !object(matches[0])) throw new Error('Missing field');
    const field = matches[0];
    if (
      !(typeof field.id === 'string' || integer(field.id)) ||
      !object(field.settings) ||
      !Array.isArray(field.settings.options)
    )
      throw new Error('Invalid field');
    const options = new Map<string, string>();
    for (const option of field.settings.options) {
      if (
        !object(option) ||
        !text(option.id) ||
        !text(option.name) ||
        options.has(option.id) ||
        [...options.values()].includes(option.name)
      )
        throw new Error('Invalid option');
      options.set(option.id, option.name);
    }
    defs.set(name, {id: String(field.id), options});
  }
  const statusOptions = [...defs.get('Status')!.options.values()];
  if (
    statusOptions.length !== 4 ||
    !['Blocked', 'In Progress', 'Done', 'Released'].every((s) => statusOptions.includes(s))
  )
    throw new Error('Unknown status');
  const statuses = {todo: 0, inProgress: 0, done: 0};
  const objectives = new Map<string, {name: string; done: number; total: number}>();
  const releases = new Set<string>();
  const seen = new Set<number>();
  let total: number | undefined;
  for (let i = 0; i < pages.length; i++) {
    const page: unknown = pages[i];
    if (
      !object(page) ||
      !Array.isArray(page.nodes) ||
      !object(page.pageInfo) ||
      !object(page.totalCount) ||
      !integer(page.totalCount.value) ||
      page.totalCount.isApproximate !== false ||
      page.pageInfo.hasNextPage !== i < pages.length - 1
    )
      throw new Error('Invalid page');
    if (total !== undefined && total !== page.totalCount.value) throw new Error('Changing total');
    total = page.totalCount.value;
    if (page.pageInfo.hasNextPage && (!text(page.pageInfo.endCursor) || page.nodes.length === 0))
      throw new Error('Invalid cursor');
    for (const node of page.nodes) {
      if (
        !object(node) ||
        !integer(node.id) ||
        seen.has(node.id) ||
        !Array.isArray(node.memexProjectColumnValues)
      )
        throw new Error('Invalid item');
      seen.add(node.id);
      const get = (name: string): string | null => {
        const def = defs.get(name)!;
        const values = (node.memexProjectColumnValues as unknown[]).filter(
          (v) => object(v) && String(v.memexProjectColumnId) === def.id,
        );
        if (values.length !== 1 || !object(values[0]) || !('value' in values[0]))
          throw new Error('Missing item field');
        const value = values[0].value;
        if (value === null) return null;
        if (!object(value) || !text(value.id) || !def.options.has(value.id))
          throw new Error('Invalid item value');
        return def.options.get(value.id)!;
      };
      const status = get('Status');
      const performance = get('Performance');
      const release = get('Release Planned');
      const done = status === 'Done' || status === 'Released';
      if (done) statuses.done++;
      else if (status === 'In Progress') statuses.inProgress++;
      else if (status === null || status === 'Blocked') statuses.todo++;
      else throw new Error('Unknown status');
      if (performance) {
        const entry = objectives.get(performance) ?? {name: performance, done: 0, total: 0};
        entry.total++;
        if (done) entry.done++;
        objectives.set(performance, entry);
      }
      if (release) releases.add(release);
    }
  }
  if (seen.size !== total) throw new Error('Incomplete snapshot');
  return {
    version: 1,
    builtAt,
    statuses,
    objectives: [...objectives.values()],
    releases: [...releases].sort((a, b) => a.localeCompare(b, 'en', {numeric: true})),
  };
}

export async function resolveRoadmap(
  fresh: () => Promise<RoadmapData>,
  cached: () => Promise<RoadmapData>,
): Promise<RoadmapState> {
  try {
    return {status: 'available', data: await fresh()};
  } catch {
    try {
      return {status: 'available', data: await cached()};
    } catch {
      return {status: 'unavailable'};
    }
  }
}
