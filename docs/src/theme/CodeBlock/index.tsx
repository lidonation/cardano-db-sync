import React, {lazy, Suspense} from 'react';
import useIsBrowser from '@docusaurus/useIsBrowser';
import type {Props} from '@theme/CodeBlock';

const LoadedCodeBlock = lazy(() => import('./Loaded'));

/** Render readable source before hydration, then load the classic highlighter on demand. */
export default function CodeBlock(props: Props) {
  const isBrowser = useIsBrowser();
  const fallback = (
    <pre>
      <code className={props.className}>{props.children}</code>
    </pre>
  );
  return isBrowser ? (
    <Suspense fallback={fallback}>
      <LoadedCodeBlock {...props} />
    </Suspense>
  ) : (
    fallback
  );
}
