import React from 'react';

import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import type {BuildProfile} from '../../config/profiles';

/**
 * Placeholder landing page.
 *
 * CON-11: app-like surfaces are React pages under `src/pages/`, not MDX documents. The designed
 * landing page arrives with the §20 design deliverables (B47); until then this page carries no
 * invented colour, type size, radius or spacing (KICKOFF §3).
 *
 * ENV-1: the route below is written with `<Link to>`, which resolves through `baseUrl`. No page
 * ever writes the prefix itself.
 */
export default function Home(): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  const profile = siteConfig.customFields?.profile as BuildProfile | undefined;

  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <main>
        <h1>{siteConfig.title}</h1>
        <p>{siteConfig.tagline}</p>
        <p>
          This site is being rebuilt. The scaffold is in place and content lands in later phases.
        </p>
        <p>
          <Link to="/docs/intro">Read the documentation</Link>
        </p>
        {profile ? (
          <p data-testid="build-network">
            This build reads the Cardano <strong>{profile.network}</strong> network.
          </p>
        ) : null}
      </main>
    </Layout>
  );
}
