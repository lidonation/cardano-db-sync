import React from 'react';

import CodeInline from '@theme-original/CodeInline';
import type CodeInlineType from '@theme/CodeInline';
import type {WrapperProps} from '@docusaurus/types';

import {IDENTIFIER_ATTRIBUTES} from '../../i18n/identifier';

type Props = WrapperProps<typeof CodeInlineType>;

/** Inline code is an identifier: English, never translated (A11Y-18). */
export default function CodeInlineWrapper(props: Props): React.JSX.Element {
  return <CodeInline {...props} {...IDENTIFIER_ATTRIBUTES} />;
}
