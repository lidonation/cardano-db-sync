import React from 'react';
import OriginalLayout from '@theme-original/Layout';
import type {Props} from '@theme/Layout';
import Metadata from '../../metadata/LazyMetadata';

/** Shared SSR/client metadata, without adding another content wrapper or altering page layouts. */
export default function Layout(props: Props): React.JSX.Element {
  return (
    <OriginalLayout {...props}>
      {props.title && props.description && (
        <Metadata title={props.title} description={props.description} />
      )}
      {props.children}
    </OriginalLayout>
  );
}
