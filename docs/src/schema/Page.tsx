import React, {useEffect} from 'react';
import Layout from '@theme/Layout';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import {PageMetadata} from '@docusaurus/theme-common';
import {useLocation} from '@docusaurus/router';
import documents from '@schema-documents';
import Metadata from '../metadata/LazyMetadata';
import {MAIN_CONTENT_ID} from '../lib/accessibility';
import type {ExplorerDocument} from './types';
import './schema.css';

/** Read only the named, build-generated document; retain only its own SSR article. */
function readDocument(root: ParentNode, permalink: string): ExplorerDocument | undefined {
  const content = root.querySelector<HTMLElement>('[data-schema-document]');
  if (content?.dataset.schemaDocument !== permalink || !content.dataset.schemaMetadata) return;
  return {html: content.innerHTML, metadata: JSON.parse(content.dataset.schemaMetadata)};
}
export default function SchemaPage(): React.JSX.Element {
  const {pathname} = useLocation();
  const permalink = pathname.replace(/\/+$/, '');
  const value =
    typeof document === 'undefined' ? documents[permalink] : readDocument(document, permalink);
  useEffect(() => {
    // Retry a missing SSR article once, including SPA history navigation. Persist the
    // marker before leaving so a partial deployment cannot create a reload loop.
    try {
      const key = 'dbsync-schema-retry';
      if (value) sessionStorage.removeItem(key);
      else if (sessionStorage.getItem(key) !== permalink) {
        sessionStorage.setItem(key, permalink);
        // A reload refetches the same document and keeps the query and column fragment;
        // replacing with an identical URL plus a fragment would only scroll, never refetch.
        location.reload();
      }
    } catch {
      // Blocked/full storage leaves the native recovery link available.
    }
  }, [permalink, Boolean(value)]);
  const brokenLinks = useBrokenLinks();
  if (value)
    for (const match of value.html.matchAll(/\bid="([^"]+)"/g)) brokenLinks.collectAnchor(match[1]);
  return (
    <Layout>
      {value && (
        <>
          <PageMetadata title={value.metadata.title} description={value.metadata.description} />
          <Metadata doc={value.metadata} />
        </>
      )}
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="container margin-vert--lg schema-content"
        lang="en"
      >
        {value ? (
          <article
            className="markdown"
            data-schema-document={permalink}
            data-schema-metadata={JSON.stringify(value.metadata)}
            dangerouslySetInnerHTML={{__html: value.html}}
          />
        ) : (
          <p role="status">
            Schema content unavailable. <a href={permalink}>Open page</a>.
          </p>
        )}
      </main>
    </Layout>
  );
}
