import React from 'react';
import OriginalCodeBlock from '@theme-original/CodeBlock';
import type {Props} from '@theme/CodeBlock';

// The classic theme's `prism-include-languages` is not called here: `prism.additionalLanguages` is
// empty, and its template-literal `require` would still bundle prismjs' component index and
// metadata (~8.7 KiB gzip) for nothing. If additional languages are ever configured, import each
// `prismjs/components/prism-<lang>` explicitly onto prism-react-renderer's Prism here instead.
export default function LoadedCodeBlock(props: Props) {
  return <OriginalCodeBlock {...props} />;
}
