import type {CommitFeedState} from '../repository-activity/types';
import {validDate} from '../updates/model';

/** Validate the same-origin asset before constructing external commit links. */
export function parseCommitFeed(value: unknown): CommitFeedState {
  if (!value || typeof value !== 'object') throw new Error('Invalid commit feed');
  const state = value as {status?: unknown; data?: unknown};
  if (state.status === 'unavailable') return {status: 'unavailable'};
  if (state.status !== 'available' || !state.data || typeof state.data !== 'object')
    throw new Error('Invalid commit feed');
  const data = state.data as {asOf?: unknown; entries?: unknown};
  if (typeof data.asOf !== 'string' || !validDate(data.asOf) || !Array.isArray(data.entries))
    throw new Error('Invalid commit feed');
  const ids = new Set<string>();
  const entries = data.entries.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid commit');
    const entry = value as {id?: unknown; date?: unknown; subject?: unknown};
    if (
      typeof entry.id !== 'string' ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.date !== 'string' ||
      !validDate(entry.date) ||
      typeof entry.subject !== 'string' ||
      entry.subject.length > 500
    )
      throw new Error('Invalid commit');
    ids.add(entry.id);
    return {id: entry.id, date: entry.date, subject: entry.subject};
  });
  return {status: 'available', data: {asOf: data.asOf, entries}};
}
