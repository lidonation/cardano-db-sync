import type {LoadContext} from '@docusaurus/types';
import {expect, it} from 'vitest';

it('does not run the publishing route-manifest plugin in the disposable Prism fixture', async () => {
  process.env.DOCS_PROFILE = 'dev';
  const [{default: fixture}, {default: routeManifest, recoveryMetadataPlugin}] = await Promise.all([
    import('../fixtures/prism/config'),
    import('../../plugins/route-manifest'),
  ]);
  expect(fixture.plugins).not.toContain(routeManifest);
  expect(fixture.plugins).toContain(recoveryMetadataPlugin);
  const metadataOnly = recoveryMetadataPlugin({baseUrl: '/fixture/'} as LoadContext);
  expect(metadataOnly.allContentLoaded).toBeTypeOf('function');
  expect(metadataOnly.postBuild).toBeUndefined();
});
