import React, {useState} from 'react';

import Layout from '@theme/Layout';

import {MAIN_CONTENT_ID} from '../../../src/lib/accessibility';
import Updates from '../../../src/updates/Updates';
import type {UpdatesFeed} from '../../../src/updates/types';

export const HOSTILE_TITLE = '<img src=x onerror="window.__updatesInjected=true">';

/** UTC boundary days: week starts Oct 6, month starts Sep 13, both ends inclusive. */
export const POPULATED_FEED: UpdatesFeed = {
  asOf: '2026-10-12',
  entries: [
    {id: 'today', date: '2026-10-12', kind: 'release', title: 'Current release', url: 'https://example.com/current'},
    {id: 'week-edge', date: '2026-10-06', kind: 'schema', title: 'Week boundary schema', url: 'https://example.com/week'},
    {id: 'before-week', date: '2026-10-05', kind: 'docs', title: 'Before week documentation', url: 'https://example.com/before-week'},
    {id: 'month-edge', date: '2026-09-13', kind: 'docs', title: HOSTILE_TITLE, url: 'https://example.com/month'},
    {id: 'before-month', date: '2026-09-12', kind: 'release', title: 'Before month release', url: 'https://example.com/before-month'},
  ],
};

/** Never deployed: inventoryPlugin admits this fixture only on the development server. */
export default function UpdatesFixture(): React.JSX.Element {
  const [feed, setFeed] = useState<UpdatesFeed | null>(POPULATED_FEED);
  return (
    <Layout title="Updates test fixture">
      <nav aria-label="Fixture feed">
        <button type="button" onClick={() => setFeed(null)}>Absent feed</button>
        <button type="button" onClick={() => setFeed({asOf: '2026-10-12', entries: []})}>Empty feed</button>
        <button type="button" onClick={() => setFeed(POPULATED_FEED)}>Populated feed</button>
      </nav>
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <h1>Updates test fixture</h1>
        <Updates feed={feed} />
      </main>
    </Layout>
  );
}
