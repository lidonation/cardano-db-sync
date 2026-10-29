import React from 'react';
import {Prism} from 'prism-react-renderer';
import includeLanguages from '@theme/prism-include-languages';
import OriginalCodeBlock from '@theme-original/CodeBlock';
import type {Props} from '@theme/CodeBlock';

// Preserve the classic theme's language registration, but only on routes using code blocks.
includeLanguages(Prism);

export default function LoadedCodeBlock(props: Props) {
  return <OriginalCodeBlock {...props} />;
}
