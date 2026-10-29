import {expect, it} from 'vitest';

it('does not run the publishing route-manifest plugin in the disposable Prism fixture', async () => {
  process.env.DOCS_PROFILE = 'dev';
  const [{default: fixture}, {default: routeManifest}] = await Promise.all([
    import('../fixtures/prism/config'),
    import('../../plugins/route-manifest'),
  ]);
  expect(fixture.plugins).not.toContain(routeManifest);
});
