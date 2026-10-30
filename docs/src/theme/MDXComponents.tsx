import React, {type ComponentProps} from 'react';
import clsx from 'clsx';
import MDXComponents from '@theme-original/MDXComponents';

import Identifier from '../components/Identifier';
import {GuideAlert, ProcedureTab, ProcedureTabs} from '../components/GuideMarkdown';

const OriginalHeading = MDXComponents.h1!;

/** `<Id>` is in scope in every MDX file, so identifiers are marked the same way everywhere. */
export default {
  ...MDXComponents,
  // Penpot's documentation title uses the shared heading style at every breakpoint.
  h1: (props: ComponentProps<'h1'>) => (
    <OriginalHeading {...props} className={clsx('dbs-type-heading-lg', props.className)} />
  ),
  Id: Identifier,
  GuideAlert,
  ProcedureTab,
  ProcedureTabs,
};
