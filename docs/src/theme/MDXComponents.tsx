import MDXComponents from '@theme-original/MDXComponents';

import Identifier from '../components/Identifier';

/** `<Id>` is in scope in every MDX file, so identifiers are marked the same way everywhere. */
export default {
  ...MDXComponents,
  Id: Identifier,
};
