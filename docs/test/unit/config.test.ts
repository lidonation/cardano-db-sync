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

  it('loads the switcher discipline last so it wins over Infima (B30)', async () => {
    const config = await loadConfig('dev');
    const [, options] = (config.presets ?? [])[0] as [string, {theme?: {customCss?: string[]}}];
    const css = options.theme?.customCss ?? [];
    expect(css[css.length - 1]).toBe('./src/css/switchers.css');
  });
});

describe('build hygiene', () => {
  it('throws on broken links and anchors rather than warning', async () => {
    const config = await loadConfig('dev');
    expect(config.onBrokenLinks).toBe('throw');
    expect(config.onBrokenAnchors).toBe('throw');
    expect(config.markdown?.hooks?.onBrokenMarkdownLinks).toBe('throw');
  });

  it('registers the CNAME, route-manifest, environment, security, i18n, inventory, CSS-prune, lazy-Prism and shared-code plugins', async () => {
    const config = await loadConfig('prod');
    const {default: cnamePlugin} = await import('../../plugins/cname');
    const {default: routeManifestPlugin} = await import('../../plugins/route-manifest');
    const {default: environmentPlugin} = await import('../../plugins/environment');
    const {default: securityPlugin} = await import('../../plugins/security');
    const {default: i18nPlugin} = await import('../../plugins/i18n');
    const {default: lazyPrismPlugin} = await import('../../plugins/lazy-prism');
    const {default: inventoryPlugin} = await import('../../plugins/inventory');
    const {default: palettePlugin} = await import('../../plugins/palette');
    const {default: cssPrunePlugin} = await import('../../plugins/css-prune');
    const {default: roadmapPlugin} = await import('../../plugins/roadmap');
    const {default: surveyResultsPlugin} = await import('../../plugins/survey-results');
    const {default: repositoryActivity} = await import('../../plugins/repository-activity');
    const {default: sharedCodePlugin} = await import('../../plugins/shared-code');
    expect(config.plugins).toEqual([
      roadmapPlugin,
      surveyResultsPlugin,
      repositoryActivity,
      cnamePlugin,
      routeManifestPlugin,
      environmentPlugin,
      securityPlugin,
      i18nPlugin,
      lazyPrismPlugin,
      inventoryPlugin,
      palettePlugin,
      cssPrunePlugin,
      sharedCodePlugin,
    ]);
  });

  it('turns off the base-URL banner, an inline script the CSP would refuse (SEC-3)', async () => {
    expect((await loadConfig('dev')).baseUrlIssueBanner).toBe(false);
  });
});

describe('B30 - the three global controls share the navbar (THM-1, A11Y-29, DF-7)', () => {
  interface NavbarItem {
    readonly type?: string;
    readonly position?: string;
  }

  async function navbarItems(): Promise<NavbarItem[]> {
    const config = await loadConfig('dev');
    const themeConfig = config.themeConfig as {navbar?: {items?: NavbarItem[]}} | undefined;
    return themeConfig?.navbar?.items ?? [];
  }

  it('keeps the locale switcher and adds the version selector on the right', async () => {
    const right = (await navbarItems())
      .filter((item) => item.position === 'right')
      .map((item) => item.type);
    expect(right).toContain('localeDropdown');
    expect(right).toContain('docsVersionDropdown');
  });

  it('leaves the theme switcher to the swizzled ColorModeToggle, not the navbar config', async () => {
    const items = await navbarItems();
    expect(items.map((item) => item.type)).not.toContain('colorModeToggle');
  });
});

describe('B01 follow-up - brand assets in static/ and favicon (#63)', () => {
  interface HeadTag {
    readonly tagName?: string;
    readonly attributes?: Record<string, string>;
  }

  async function headTags(profile?: string): Promise<HeadTag[]> {
    const config = await loadConfig(profile);
    return (config.headTags ?? []) as HeadTag[];
  }

  it('emits the global favicon directly, without locale resolution or an absolute URL', async () => {
    for (const name of ['dev', 'prod'] as const) {
      const config = await loadConfig(name);
      expect(config.favicon).toBeUndefined();
      const tags = await headTags(name);
      const icons = tags.filter((tag) => tag.attributes?.rel === 'icon');
      expect(icons).toHaveLength(1);
      expect(icons[0].tagName).toBe('link');
      expect(icons[0].attributes?.href).toBe(
        `${PROFILES[name].baseUrl}brand/png/mark-badge-32.png`,
      );
    }
  });

  it('adds an Apple touch icon via headTags, baseUrl-relative per profile', async () => {
    for (const name of ['dev', 'prod'] as const) {
      const tags = await headTags(name);
      const apple = tags.find((tag) => tag.attributes?.rel === 'apple-touch-icon');
      expect(apple?.tagName).toBe('link');
      expect(apple?.attributes?.href).toBe(`${PROFILES[name].baseUrl}brand/png/mark-badge-180.png`);
    }
  });

  it('keeps the favicon and touch icon free of hardcoded environment values (ENV-1)', async () => {
    const source = await fs.readFile(CONFIG_PATH, 'utf8');
    expect(source).not.toContain('/cardano-db-sync/');
    expect(source).not.toMatch(/favicon\s*:\s*['"`]\//);
    expect(source).not.toMatch(/favicon\s*:\s*['"`]https?:/);
    expect(source).toContain('profile.baseUrl');
  });

  it('ships the brand marks from static/ with no public/ tree left', async () => {
    const docsRoot = path.resolve(CONFIG_PATH, '..');
    await expect(
      fs.stat(path.join(docsRoot, 'static/brand/png/mark-badge-32.png')),
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(docsRoot, 'static/brand/png/mark-badge-180.png')),
    ).resolves.toBeDefined();
    await expect(fs.stat(path.join(docsRoot, 'public'))).rejects.toThrow(/ENOENT/);
  });
});
