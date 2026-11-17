import React from 'react';
import {PageMetadata} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import Metadata from '../../../metadata/LazyMetadata';
import {contentType} from '../../../metadata/identity';
import type {ContentMetadata} from '../../../metadata/types';

/** Doc payload stays lazy with its document, not in the site's global chrome bundle. */
export default function DocItemMetadata(): React.JSX.Element {
  const {metadata, frontMatter, assets} = useDoc();
  return (
    <>
      <Metadata
        doc={{
          type: contentType(metadata.permalink, true, metadata.id),
          title: metadata.title,
          description: metadata.description,
          version: metadata.version,
          steps: (frontMatter as typeof frontMatter & {metadata_steps?: ContentMetadata['steps']})
            .metadata_steps,
        }}
      />
      <PageMetadata
        title={metadata.title}
        description={metadata.description}
        keywords={frontMatter.keywords}
        image={assets.image ?? frontMatter.image}
      />
    </>
  );
}
