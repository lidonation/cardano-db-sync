import React, {type ReactNode} from 'react';

import {useDoc} from '@docusaurus/plugin-content-docs/client';

import Pagination from '../../../components/Pagination';

/** B34 — the previous and next doc as the `Pagination / Prev-Next` cards (44px and up). */
export default function DocItemPaginator(): ReactNode {
  const {previous, next} = useDoc().metadata;
  return (
    <Pagination
      previous={previous && {href: previous.permalink, title: previous.title}}
      next={next && {href: next.permalink, title: next.title}}
    />
  );
}
