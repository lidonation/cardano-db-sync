import React from 'react';

import Translate, {translate} from '@docusaurus/Translate';

import type {CardanoNetwork} from '../../../config/profiles';

import styles from './styles.module.css';

export interface EnvironmentBannerProps {
  /** Network the build reads. */
  readonly network: CardanoNetwork;
  /** Production site origin plus base path, for the way out. */
  readonly productionUrl: string;
}

/**
 * ENV-4 — the persistent environment banner on non-production builds.
 *
 * Dev and production must never be confusable at a glance, so the banner names the environment in
 * a word as well as a colour (FLOOR-6), cannot be dismissed, and links to the production site.
 * Its one interactive element is that link, which has hover and focus-visible states; it has no
 * disabled, loading, error or empty state because it holds no data and starts no action.
 *
 * Every string goes through `<Translate>` so the banner is localised with the rest of the site
 * (I18N). The "not on mainnet" sentence is only said when it is true of the build's network.
 */
export default function EnvironmentBanner({
  network,
  productionUrl,
}: EnvironmentBannerProps): React.JSX.Element {
  return (
    <aside
      className={styles.banner}
      aria-label={translate({
        id: 'environmentBanner.ariaLabel',
        message: 'Build environment',
        description: 'Accessible name of the non-production environment banner',
      })}
      data-environment={network}
    >
      <strong className={styles.label}>
        <Translate id="environmentBanner.label" description="Environment name on the banner">
          Preview
        </Translate>
      </strong>
      <span>
        {network === 'mainnet' ? (
          <Translate
            id="environmentBanner.description.mainnet"
            description="Banner text when a non-production build reads mainnet"
            values={{network}}
          >
            {'This is a development build. It reads the Cardano {network} network.'}
          </Translate>
        ) : (
          <Translate
            id="environmentBanner.description.testnet"
            description="Banner text when a non-production build reads a test network"
            values={{network}}
          >
            {
              'This is a development build. It reads the Cardano {network} network, and nothing here is on mainnet.'
            }
          </Translate>
        )}
      </span>
      <a className={styles.link} href={productionUrl}>
        <Translate id="environmentBanner.productionLink" description="Link to the production site">
          Go to the production site
        </Translate>
      </a>
    </aside>
  );
}
