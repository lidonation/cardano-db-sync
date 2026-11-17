import React from 'react';
import Head from '@docusaurus/Head';
import {useBreadcrumbsStructuredData} from '@docusaurus/plugin-content-docs/client';
import type {Props} from '@theme/DocBreadcrumbs/StructuredData';
import {serializeJsonLd} from '../../../faq/jsonld';

/** Reuse the sidebar producer, escaping script-closing text exactly like the other templates. */
export default function DocBreadcrumbsStructuredData(props: Props): React.JSX.Element {
  const data = useBreadcrumbsStructuredData({breadcrumbs: props.breadcrumbs});
  return (
    <Head>
      <script type="application/ld+json" key="breadcrumb-jsonld">
        {serializeJsonLd(data)}
      </script>
    </Head>
  );
}
