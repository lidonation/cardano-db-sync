import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import type {BuildProfile} from '../../config/profiles';

/** The build values `docusaurus.config.ts` exposes through `customFields` (ENV-1, ENV-4). */
export interface BuildEnvironment {
  /** The active build profile. */
  readonly profile: BuildProfile;
  /** Production origin plus base path, for the environment banner's way out. */
  readonly productionUrl: string;
}

/**
 * Read the build profile from the site config, the one place every page and component gets it.
 * Throws when the config does not carry it, so a misconfigured build fails at render rather than
 * shipping a page that cannot tell which environment it is in.
 */
export default function useBuildEnvironment(): BuildEnvironment {
  const {siteConfig} = useDocusaurusContext();
  const profile = siteConfig.customFields?.profile as BuildProfile | undefined;
  const productionUrl = siteConfig.customFields?.productionUrl;

  if (profile === undefined || typeof productionUrl !== 'string') {
    throw new Error(
      'siteConfig.customFields must carry the build profile and productionUrl (docusaurus.config.ts).',
    );
  }

  return {profile, productionUrl};
}
