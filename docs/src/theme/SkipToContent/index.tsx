import React, {useRef} from 'react';

import {translate} from '@docusaurus/Translate';
import {useHistory} from '@docusaurus/router';
import {useLocationChange} from '@docusaurus/theme-common/internal';

import {MAIN_CONTENT_ID} from '../../lib/accessibility';

/**
 * A11Y-5: a native anchor to main also works before hydration or without JavaScript.
 * Keep Docusaurus' focus reset after a PUSH navigation, but leave hash navigation alone.
 */
export default function SkipToContent(): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const {action} = useHistory();
  const label = translate({
    id: 'theme.common.skipToMainContent',
    message: 'Skip to main content',
    description: 'First keyboard stop, bypasses the site and documentation navigation',
  });
  useLocationChange(({location}) => {
    if (action === 'PUSH' && !location.hash) {
      container.current?.focus();
    }
  });
  return (
    <div ref={container} tabIndex={-1} role="region" aria-label={label}>
      <a
        className="dbs-skip-link"
        href={`#${MAIN_CONTENT_ID}`}
        onClick={(event) => {
          const main = document.getElementById(MAIN_CONTENT_ID);
          if (main) {
            event.preventDefault();
            main.focus();
            main.scrollIntoView({block: 'start'});
          }
        }}
      >
        {label}
      </a>
    </div>
  );
}
