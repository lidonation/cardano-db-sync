import {load} from 'cheerio';
import {transform} from './data';
import type {RoadmapData} from '../../src/roadmap/types';

const BOARD = 'https://github.com/orgs/IntersectMBO/projects/8';
const ITEMS = 'https://github.com/memexes/6909988/paginated_items';
// Bound the entire anonymous snapshot, not just each individual page.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
interface RetrievalBudget {
  signal: AbortSignal;
  remainingBytes: number;
}
const retrievalBudget = (): RetrievalBudget => ({
  signal: AbortSignal.timeout(60_000),
  remainingBytes: 20 * 1024 * 1024,
});
async function request(
  url: string,
  send: typeof fetch,
  accept: string,
  budget: RetrievalBudget,
): Promise<string> {
  budget.signal.throwIfAborted();
  const response = await send(url, {
    headers: {accept},
    redirect: 'error',
    signal: AbortSignal.any([budget.signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error(`Roadmap source returned ${response.status}`);
  if (!response.body) throw new Error('Missing roadmap response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      budget.signal.throwIfAborted();
      const {done, value} = await reader.read();
      budget.signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      budget.remainingBytes -= value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES || budget.remainingBytes < 0)
        throw new Error('Roadmap response exceeds size limit');
      text += decoder.decode(value, {stream: true});
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export async function readPages(
  send: typeof fetch = fetch,
  budget = retrievalBudget(),
): Promise<unknown[]> {
  const pages: unknown[] = [];
  const cursors = new Set<string>();
  let after = '';
  let more = true;
  while (more) {
    const url = new URL(ITEMS);
    if (after) url.searchParams.set('after', after);
    const page: unknown = JSON.parse(
      await request(url.toString(), send, 'application/json', budget),
    );
    if (
      !page ||
      typeof page !== 'object' ||
      !('pageInfo' in page) ||
      !page.pageInfo ||
      typeof page.pageInfo !== 'object' ||
      !('hasNextPage' in page.pageInfo) ||
      typeof page.pageInfo.hasNextPage !== 'boolean'
    )
      throw new Error('Malformed page');
    pages.push(page);
    if (!page.pageInfo.hasNextPage) {
      more = false;
      continue;
    }
    if (
      !('endCursor' in page.pageInfo) ||
      typeof page.pageInfo.endCursor !== 'string' ||
      !page.pageInfo.endCursor ||
      cursors.has(page.pageInfo.endCursor) ||
      pages.length >= 100
    )
      throw new Error('Invalid cursor');
    after = page.pageInfo.endCursor;
    cursors.add(after);
  }
  return pages;
}
export async function readRoadmap(send: typeof fetch = fetch): Promise<RoadmapData> {
  const budget = retrievalBudget();
  const html = await request(BOARD, send, 'text/html', budget);
  const $ = load(html);
  const read = (id: string): unknown => {
    const node = $(`script#${id}`);
    if (node.length !== 1) throw new Error('Board format changed');
    return JSON.parse(node.text());
  };
  const api = read('memex-paginated-items-get-api-data');
  if (
    !api ||
    typeof api !== 'object' ||
    !('url' in api) ||
    api.url !== '/memexes/6909988/paginated_items'
  )
    throw new Error('Unexpected project endpoint');
  const fields = read('memex-columns-data');
  const board = read('memex-paginated-items-data');
  if (
    !board ||
    typeof board !== 'object' ||
    !('totalCount' in board) ||
    !board.totalCount ||
    typeof board.totalCount !== 'object' ||
    !('value' in board.totalCount) ||
    !('isApproximate' in board.totalCount) ||
    board.totalCount.isApproximate !== false
  )
    throw new Error('Missing board total');
  if (
    !('groups' in board) ||
    !board.groups ||
    typeof board.groups !== 'object' ||
    !('nodes' in board.groups) ||
    !Array.isArray(board.groups.nodes)
  )
    throw new Error('Missing board groups');
  const counts = new Map<string, number>();
  for (const group of board.groups.nodes) {
    if (
      !group ||
      typeof group !== 'object' ||
      typeof group.groupValue !== 'string' ||
      !group.totalCount ||
      !Number.isSafeInteger(group.totalCount.value) ||
      group.totalCount.value < 0 ||
      group.totalCount.isApproximate !== false ||
      counts.has(group.groupValue)
    )
      throw new Error('Invalid board group');
    counts.set(group.groupValue, group.totalCount.value);
  }
  if (
    counts.size !== 5 ||
    !['_noValue', 'Blocked', 'In Progress', 'Done', 'Released'].every((name) => counts.has(name))
  )
    throw new Error('Unexpected board groups');
  const result = transform(fields, await readPages(send, budget), new Date().toISOString());
  if (
    result.statuses.todo + result.statuses.inProgress + result.statuses.done !==
    board.totalCount.value
  )
    throw new Error('Board changed during retrieval');
  if (
    result.statuses.todo !== counts.get('_noValue')! + counts.get('Blocked')! ||
    result.statuses.inProgress !== counts.get('In Progress') ||
    result.statuses.done !== counts.get('Done')! + counts.get('Released')!
  )
    throw new Error('Board groups changed during retrieval');
  return result;
}
