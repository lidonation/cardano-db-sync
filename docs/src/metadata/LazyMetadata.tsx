import React, {lazy, Suspense} from 'react';
import type MetadataComponent from './Metadata';

const Metadata = lazy(() => import('./Metadata'));

/** Metadata renders during streaming SSR; its client reconciler is not critical UI code. */
export default function LazyMetadata(
  props: React.ComponentProps<typeof MetadataComponent>,
): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <Metadata {...props} />
    </Suspense>
  );
}
