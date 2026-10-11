import React from 'react';

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
 */
export default function EnvironmentBanner({
  network,
  productionUrl,
}: EnvironmentBannerProps): React.JSX.Element {
  return (
    <aside className={styles.banner} aria-label="Build environment" data-environment={network}>
      <strong className={styles.label}>Preview</strong>
      <span>
        This is a development build. It reads the Cardano {network} network, and nothing here is on
        mainnet.
      </span>
      <a className={styles.link} href={productionUrl}>
        Go to the production site
      </a>
    </aside>
  );
}
