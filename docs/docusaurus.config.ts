import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

import {I18N} from './config/i18n';
import {PROFILES, resolveProfile} from './config/profiles';
import cnamePlugin from './plugins/cname';
import environmentPlugin from './plugins/environment';
import i18nPlugin from './plugins/i18n';
import inventoryPlugin from './plugins/inventory';
import palettePlugin from './plugins/palette';
import routeManifestPlugin from './plugins/route-manifest';
import securityPlugin from './plugins/security';

const profile = resolveProfile();

/**
 * CON-9 — do not change: `markdown.format` is deliberately absent, which leaves Docusaurus at its
 * `mdx` default. Setting it to `detect` switches `.md` files to CommonMark parsing, which
 * Docusaurus documents as experimental with limitations. Content is authored as CommonMark
 * (CON-8) and compiled as MDX. `config.test.ts` fails the build if a `format` key appears here.
 */
const config: Config = {
  title: 'Cardano DB Sync',
  tagline: 'The Cardano chain, as a Postgres database you can query',
  favicon: undefined,

  // ENV-1 — both values come from the profile. Nothing here is environment-specific.
  url: profile.url,
  baseUrl: profile.baseUrl,

  organizationName: profile.organizationName,
  projectName: profile.projectName,

  onBrokenLinks: 'throw',
  // SEC-3: the base-URL warning banner is an inline script with inline styles. The profiles own
  // baseUrl (ENV-1), so the runtime check has nothing to catch.
  baseUrlIssueBanner: false,
  onBrokenAnchors: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  // Exposed to pages and components so no surface re-derives the environment (ENV-1, ENV-2).
  customFields: {
    profile,
    // ENV-4: the environment banner's way out to the real site.
    productionUrl: `${PROFILES.prod.url}${PROFILES.prod.baseUrl}`,
  },

  // A11Y-18: `lang` and `dir` on <html> come from each locale's config (B40).
  i18n: I18N,

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
          editUrl: `${profile.repoUrl}/tree/master/docs/`,
        },
        blog: false,
        theme: {
          // TOK-1: the generated tokens are imported once, here, ahead of everything that uses them.
          // B30: the switcher discipline rides last so it wins over Infima on equal specificity.
          customCss: [
            './src/css/tokens.css',
            './src/css/fonts.css',
            './src/css/custom.css',
            './src/css/switchers.css',
          ],
        },
      } satisfies Preset.Options,
    ],
  ],

  // VER-5: records every published route and redirects retired ones (B04). ENV-3: noindex and
  // robots.txt per profile (B05).
  // SEC-1..3, SEC-8: a per-route meta CSP in every page, the colour-mode bootstrap hashed (B06).
  // META-4, A11Y-18: which locales each page exists in, for hreflang and fallback marking (B40).
  // B29: the component inventory, on the development server only (DBS_INVENTORY=1).
  // THM-1 (B30): the palette bootstrap restoring data-dbs-palette before paint.
  plugins: [
    cnamePlugin,
    routeManifestPlugin,
    environmentPlugin,
    securityPlugin,
    i18nPlugin,
    inventoryPlugin,
    palettePlugin,
  ],

  themeConfig: {
    navbar: {
      title: 'Cardano DB Sync',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        // B30: the three global controls share one discipline (THM-1, A11Y-29, DF-7).
        // The theme switcher is the swizzled ColorModeToggle (four palettes); locale and
        // version ride on Docusaurus' own dropdowns so same-page navigation (hreflang
        // alternates, equivalent version pages) is preserved, restyled in switchers.css.
        {type: 'localeDropdown', position: 'right'},
        {type: 'docsVersionDropdown', position: 'right'},
        {
          href: profile.repoUrl,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      copyright: `Cardano DB Sync is maintained by Intersect. Built ${new Date().getFullYear()}.`,
    },
    colorMode: {
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
