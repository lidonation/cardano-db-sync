import React from 'react';

import Content from '@theme-original/DocItem/Content';
import type ContentType from '@theme/DocItem/Content';
import type {WrapperProps} from '@docusaurus/types';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useDoc} from '@docusaurus/plugin-content-docs/client';

import {isTranslatedDoc} from '../../../i18n/pages';

type Props = WrapperProps<typeof ContentType>;

/**
 * A11Y-18: a doc with no translation in this locale renders its English source under a localised
 * page, so the content says it is English. Translated docs inherit the page's language.
 */
export default function ContentWrapper(props: Props): React.JSX.Element {
  const {
    i18n: {currentLocale, defaultLocale},
  } = useDocusaurusContext();
  const {metadata} = useDoc();
  const lang = isTranslatedDoc(metadata.source, currentLocale, defaultLocale) ? undefined : 'en';
  return (
    <div lang={lang}>
      <Content {...props} />
    </div>
  );
}
