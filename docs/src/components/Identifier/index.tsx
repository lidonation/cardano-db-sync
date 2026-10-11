import React, {type ReactNode} from 'react';

import {IDENTIFIER_ATTRIBUTES} from '../../i18n/identifier';

/**
 * An identifier in running prose that is not set as code: a product or protocol name such as
 * `<Id>SMASH</Id>`. Available in every MDX file as `<Id>` (A11Y-18).
 */
export default function Identifier({children}: {children: ReactNode}): React.JSX.Element {
  return <span {...IDENTIFIER_ATTRIBUTES}>{children}</span>;
}
