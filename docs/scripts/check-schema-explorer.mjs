#!/usr/bin/env node
/** Database-free integrity checks; byte-identical replay is checked by extract-schema CI. */
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {fingerprint} from './lib/schema-model.mjs';
const history = JSON.parse(
  readFileSync(new URL('../generated/schema-explorer.json', import.meta.url), 'utf8'),
);
if (history.schemaVersion !== 1 || !Number.isInteger(history.current?.stageFour))
  throw new Error('Invalid explorer history version');
for (const [key, events] of Object.entries(history.changes)) {
  if (!events.length) throw new Error(`Empty history ${key}`);
  for (const event of events)
    for (const column of [event.before, event.after])
      if (column && column.fingerprint !== fingerprint(column))
        throw new Error(`Invalid history fingerprint ${key}`);
}
console.log(
  `Explorer history: ${Object.keys(history.changes).length} column histories, ${history.relationships.length} typed/enforced relationships.`,
);
