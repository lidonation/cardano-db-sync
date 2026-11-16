/** VER-6: unknown routes stay 404s; recovery choices are links, never automatic redirects. */
import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import Head from '@docusaurus/Head';
import {useLocation} from '@docusaurus/router';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useIsBrowser from '@docusaurus/useIsBrowser';
import data from '@generated/dbsync-route-manifest/default/recovery.json';
import type {Props} from '@theme/NotFound/Content';
import Heading from '@theme/Heading';

import {MAIN_CONTENT_ID} from '../../../lib/accessibility';
import useBuildEnvironment from '../../../lib/useBuildEnvironment';
import {
  archiveUrl,
  recoveryContext,
  retiredVersion,
  retirementTarget,
} from '../../../retirement/routes';

export default function NotFoundContent({className}: Props): ReactNode {
  const {pathname} = useLocation();
  const {i18n} = useDocusaurusContext();
  const isBrowser = useIsBrowser();
  const {profile} = useBuildEnvironment();
  // Static Pages serves one file at arbitrary addresses. Hydrate the same generic shell first,
  // then describe the actual requested path, not the build-time /404.html pathname.
  const request = recoveryContext(
    isBrowser ? pathname : `${profile.baseUrl}404.html`,
    profile.baseUrl,
    i18n.locales.filter((locale) => locale !== i18n.defaultLocale),
  );
  const {route} = request;
  const href = (path: string) => `${request.baseUrl}${path.slice(1)}`;
  const version = retiredVersion(route, data.lines);
  const target = retirementTarget(route, new Set(data.routes), data);
  const latest = data.routes.includes(`${data.latest.path}/intro`)
    ? `${data.latest.path}/intro`
    : '/';
  const guides = data.routes.includes(`${data.latest.path}/guides`)
    ? `${data.latest.path}/guides`
    : latest;
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      lang="en"
      className={clsx('container margin-vert--xl', className)}
    >
      {profile.indexable && (
        <Head>
          <meta name="robots" content="noindex" />
        </Head>
      )}
      <div className="row">
        <div className="col col--6 col--offset-3">
          <Heading as="h1" className="hero__title">
            Page not found
          </Heading>
          {version ? (
            <p>
              Documentation for <strong>{version.name}</strong> has retired or is not available in
              this build.
            </p>
          ) : (
            <p>This page is not available. It may have moved, or the address may be incorrect.</p>
          )}
          <p>
            Retired releases remain available in the git archive. Choose a current equivalent or the
            archived release; this page will not redirect you automatically.
          </p>
          <ul>
            <li>
              <a href={href(target === '/' ? latest : target)}>
                {target === '/'
                  ? 'Read the current documentation'
                  : 'Open the nearest current equivalent'}
              </a>
            </li>
            <li>
              <a href={archiveUrl(profile.repoUrl, version?.name, data.tags)}>
                {version &&
                data.tags.some((tag) => tag.replace(/^v/, '') === version.name.replace(/^v/, ''))
                  ? `Read the ${version.name} archive`
                  : 'Browse archived releases'}
              </a>
            </li>
            <li>
              <a href={href(guides)}>Browse the guides</a>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
