import React from 'react';

import AnnouncementBar from '@theme-original/AnnouncementBar';
import type AnnouncementBarType from '@theme/AnnouncementBar';
import type {WrapperProps} from '@docusaurus/types';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import EnvironmentBanner from '../../components/EnvironmentBanner';
import type {BuildProfile} from '../../../config/profiles';

type Props = WrapperProps<typeof AnnouncementBarType>;

/**
 * ENV-4: a non-production build shows the environment banner on every page. It sits in the
 * announcement bar's slot, which every layout renders after the skip link and before the navbar,
 * so the skip link stays the first tab stop.
 */
export default function AnnouncementBarWrapper(props: Props): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  const profile = siteConfig.customFields?.profile as BuildProfile;
  const productionUrl = siteConfig.customFields?.productionUrl as string;

  return (
    <>
      {profile.indexable ? null : (
        <EnvironmentBanner network={profile.network} productionUrl={productionUrl} />
      )}
      <AnnouncementBar {...props} />
    </>
  );
}
