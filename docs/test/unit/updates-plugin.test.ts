import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {LoadContext} from '@docusaurus/types';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {PROFILES} from '../../config/profiles';
import updatesPlugin from '../../plugins/updates';
import {readUpdates} from '../../plugins/updates/history';
import {atomFeed, rssFeed} from '../../plugins/updates/xml';
const feed = {
  asOf: '2026-01-01',
  entries: [
    {
      id: 'docs:abc',
      kind: 'docs' as const,
      title: 'Docs',
      date: '2026-01-01',
      url: 'https://github.com/example/repo/commit/abc',
    },
  ],
};
vi.mock('../../plugins/updates/history', () => ({readUpdates: vi.fn(() => feed)}));
afterEach(() => vi.unstubAllEnvs());

describe('Updates build wiring (R2, R3)', () => {
  it('pins a shared locale snapshot and publishes both feeds from exactly that JSON', async () => {
    vi.stubEnv('DOCS_PROFILE', 'dev');
    const root = await mkdtemp(path.join(os.tmpdir(), 'updates-plugin-'));
    const context = (currentLocale: string) =>
      ({
        siteDir: path.join(root, 'docs'),
        i18n: {currentLocale, defaultLocale: 'en'},
      }) as LoadContext;
    try {
      const plugin = updatesPlugin(context('en'));
      const createData = vi.fn();
      await plugin.contentLoaded!({actions: {createData}} as never);
      expect(createData).toHaveBeenCalledWith('feed.json', JSON.stringify(feed));
      // Docusaurus reloads plugin modules between locales in one build process.
      vi.resetModules();
      const {default: reloadedPlugin} = await import('../../plugins/updates');
      const other = reloadedPlugin(context('ja'));
      await other.contentLoaded!({actions: {createData}} as never);
      expect(readUpdates).toHaveBeenCalledTimes(1);
      await other.postBuild!({outDir: path.join(root, 'ja')} as never);
      await expect(readFile(path.join(root, 'ja/updates/rss.xml'))).rejects.toThrow();
      await plugin.postBuild!({outDir: root} as never);
      expect(await readFile(path.join(root, 'updates/rss.xml'), 'utf8')).toBe(
        rssFeed(feed, PROFILES.dev),
      );
      expect(await readFile(path.join(root, 'updates/atom.xml'), 'utf8')).toBe(
        atomFeed(feed, PROFILES.dev),
      );
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
  it('propagates extraction failures rather than claiming there were no releases', async () => {
    vi.stubEnv('DOCS_PROFILE', 'prod');
    vi.mocked(readUpdates).mockImplementationOnce(() => {
      throw new Error('shallow history');
    });
    const plugin = updatesPlugin({siteDir: '/unique-unavailable/docs'} as LoadContext);
    await expect(plugin.contentLoaded!({actions: {createData: vi.fn()}} as never)).rejects.toThrow(
      'shallow history',
    );
  });
});

it('lets detached documentation fixtures name the real history checkout explicitly', async () => {
  vi.stubEnv('DOCS_PROFILE', 'dev');
  vi.stubEnv('UPDATES_CHECKOUT', '/canonical-history');
  vi.mocked(readUpdates).mockImplementationOnce(() => feed);
  const plugin = updatesPlugin({siteDir: '/detached/docs'} as LoadContext);
  await plugin.contentLoaded!({actions: {createData: vi.fn()}} as never);
  expect(readUpdates).toHaveBeenLastCalledWith('/canonical-history');
});
