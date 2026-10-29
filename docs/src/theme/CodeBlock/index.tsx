import React, {lazy, Suspense} from 'react';
import ErrorBoundary from '@docusaurus/ErrorBoundary';
import useIsBrowser from '@docusaurus/useIsBrowser';
import ElementContent from '@theme/CodeBlock/Content/Element';
import type {Props} from '@theme/CodeBlock';

const LoadedCodeBlock = lazy(() => import(/* webpackChunkName: "code-block" */ './Loaded'));

/** Render readable source before hydration, then load the classic highlighter on demand. */
export default function CodeBlock(props: Props) {
  const isBrowser = useIsBrowser();
  const fallback = <ElementContent className={props.className}>{props.children}</ElementContent>;
  return isBrowser ? (
    <ErrorBoundary fallback={() => fallback}>
      <Suspense fallback={fallback}>
        <LoadedCodeBlock {...props} />
      </Suspense>
    </ErrorBoundary>
  ) : (
    fallback
  );
}
