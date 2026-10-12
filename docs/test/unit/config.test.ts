import fs from 'node:fs/promises';
import path from 'node:path';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {PROFILES} from '../../config/profiles';

const CONFIG_PATH = path.resolve(import.meta.dirname, '../../docusaurus.config.ts');

const originalProfile = process.env.DOCS_PROFILE;

function restoreProfile() {
  if (originalProfile === undefined) {
    delete process.env.DOCS_PROFILE;
  } else {
    process.env.DOCS_PROFILE = originalProfile;
  }
}

afterEach(() => {
  restoreProfile();
  vi.resetModules();
});

/** Load the config fresh, so the module-level resolveProfile() call runs again. */
async function loadConfig(profile?: string) {
  vi.resetModules();
  if (profile === undefined) {
    delete process.env.DOCS_PROFILE;
  } else {
    process.env.DOCS_PROFILE = profile;
  }
  const module = await import('../../docusaurus.config');
  return module.default;
}

describe('docusaurus.config (ENV-1)', () => {
  it('takes url and baseUrl from the developer profile', async () => {
    const config = await loadConfig('dev');
    expect(config.url).toBe(PROFILES.dev.url);
    expect(config.baseUrl).toBe(PROFILES.dev.baseUrl);
  });

  it('takes url and baseUrl from the production profile', async () => {
    const config = await loadConfig('prod');
    expect(config.url).toBe(PROFILES.prod.url);
    expect(config.baseUrl).toBe(PROFILES.prod.baseUrl);
  });

  it('takes the GitHub owner and repository from the profile', async () => {
    const dev = await loadConfig('dev');
    expect(dev.organizationName).toBe(PROFILES.dev.organizationName);
    expect(dev.projectName).toBe(PROFILES.dev.projectName);

    const prod = await loadConfig('prod');
    expect(prod.organizationName).toBe(PROFILES.prod.organizationName);
  });

  it('publishes the resolved profile to pages through customFields', async () => {
    const config = await loadConfig('dev');
    expect(config.customFields?.profile).toEqual(PROFILES.dev);
  });

  it('counts the landing page facts at build time (B44-a)', async () => {
    const config = await loadConfig('dev');
    const {releaseFacts} = await import('../../src/data/release-facts');
    expect(config.customFields?.releaseFacts).toEqual(releaseFacts());
  });

  it('gives every profile the production address for the environment banner (ENV-4)', async () => {
    for (const name of ['dev', 'prod']) {
      const config = await loadConfig(name);
      expect(config.customFields?.productionUrl).toBe('https://dbsync.cardano.intersect.org/');
    }
  });

  it('fails to load at all when no profile is selected', async () => {
    await expect(loadConfig(undefined)).rejects.toThrow(/is not set/);
  });

  it('fails to load on an unknown profile', async () => {
    await expect(loadConfig('staging')).rejects.toThrow(/not a known profile/);
  });
});

describe('CON-9 - markdown.format stays at the mdx default', () => {
  it('never sets markdown.format in the loaded config', async () => {
    const config = await loadConfig('dev');
    expect(config.markdown?.format).toBeUndefined();
  });

  it('has no format key in the config source', async () => {
    const source = await fs.readFile(CONFIG_PATH, 'utf8');
    const assignments = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('*'))
      .filter((line) => /\bformat\s*:/.test(line));
    expect(assignments).toEqual([]);
  });

  it('records the do-not-change reason next to the config', async () => {
    const source = await fs.readFile(CONFIG_PATH, 'utf8');
    expect(source).toMatch(/CON-9/);
  });
});

describe('TOK-1 - tokens.css is imported once, at the root', () => {
  it('lists the generated tokens first in customCss, exactly once', async () => {
    const config = await loadConfig('dev');
    const [, options] = (config.presets ?? [])[0] as [string, {theme?: {customCss?: string[]}}];
    const css = options.theme?.customCss ?? [];
    expect(css[0]).toBe('./src/css/tokens.css');
    expect(css.filter((f) => f.endsWith('tokens.css'))).toHaveLength(1);
  });
});

describe('build hygiene', () => {
  it('throws on broken links and anchors rather than warning', async () => {
    const config = await loadConfig('dev');
    expect(config.onBrokenLinks).toBe('throw');
    expect(config.onBrokenAnchors).toBe('throw');
    expect(config.markdown?.hooks?.onBrokenMarkdownLinks).toBe('throw');
  });

  it('registers the CNAME, route-manifest, environment, security, i18n, inventory and CSS-prune plugins', async () => {
    const config = await loadConfig('prod');
    const {default: cnamePlugin} = await import('../../plugins/cname');
    const {default: routeManifestPlugin} = await import('../../plugins/route-manifest');
    const {default: environmentPlugin} = await import('../../plugins/environment');
    const {default: securityPlugin} = await import('../../plugins/security');
    const {default: i18nPlugin} = await import('../../plugins/i18n');
    const {default: inventoryPlugin} = await import('../../plugins/inventory');
    const {default: cssPrunePlugin} = await import('../../plugins/css-prune');
    expect(config.plugins).toEqual([
      cnamePlugin,
      routeManifestPlugin,
      environmentPlugin,
      securityPlugin,
      i18nPlugin,
      inventoryPlugin,
      cssPrunePlugin,
    ]);
  });

  it('turns off the base-URL banner, an inline script the CSP would refuse (SEC-3)', async () => {
    expect((await loadConfig('dev')).baseUrlIssueBanner).toBe(false);
  });
});
