import pagefindProse from './plugins/pagefind-prose';
import roadmapPlugin from './plugins/roadmap';
import staticGuidePlugin from './plugins/static-guide-content';
import guideMarkdown from './plugins/guide-markdown/index.mjs';
import surveyResultsPlugin from './plugins/survey-results';
import repositoryActivityPlugin from './plugins/repository-activity';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

import {I18N} from './config/i18n';
import {PROFILES, resolveProfile} from './config/profiles';
import cnamePlugin from './plugins/cname';
import sharedCodePlugin from './plugins/shared-code';
import cssPrunePlugin from './plugins/css-prune';
import environmentPlugin from './plugins/environment';
import i18nPlugin from './plugins/i18n';
import lazyPrismPlugin from './plugins/lazy-prism';
import inventoryPlugin, {layoutFixturePlugins} from './plugins/inventory';
import palettePlugin from './plugins/palette';
import routeManifestPlugin from './plugins/route-manifest';
import securityPlugin from './plugins/security';
import {NAVBAR_MENU, FOOTER_MENU, SURFACES} from './src/data/surfaces';
import {releaseFacts} from './src/data/release-facts';
import {loadReleaseHistory} from './src/data/release-history';

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
  // Docusaurus resolves `favicon` through the active locale baseUrl, but static assets
  // are global. Emit both icon links directly from the profile baseUrl to avoid locale
  // prefixes and absolute asset URLs (SEC-2). The navbar logo stays with B47.
  favicon: undefined,
  headTags: [
    ['icon', 'brand/png/mark-badge-32.png'],
    ['apple-touch-icon', 'brand/png/mark-badge-180.png'],
  ].map(([rel, file]) => ({
    tagName: 'link',
    attributes: {rel, href: `${profile.baseUrl}${file}`},
  })),

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
    // B44-a: the landing page's "in this build" figures, counted here at build time so the
    // schema artifact they come from never ships to the browser.
    releaseFacts: releaseFacts(),
    // B44-b: the Ecosystem page's release history, counted from the committed changelog.
    releaseHistory: loadReleaseHistory(),
  },

  // A11Y-18: `lang` and `dir` on <html> come from each locale's config (B40).
  i18n: I18N,

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          remarkPlugins: [guideMarkdown],
          routeBasePath: 'docs',
          versions: {current: {label: 'Unreleased'}},
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
  // B29: the component inventory, on the development server only (DBS_INVENTORY=1); B34's layout
  // fixture docs behind the same flag.
  // THM-1 (B30): the palette bootstrap restoring data-dbs-palette before paint.
  // PERF-1: the stylesheet keeps only rules the build can match.
  plugins: [
    pagefindProse,
    staticGuidePlugin,
    roadmapPlugin,
    surveyResultsPlugin,
    repositoryActivityPlugin,
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
    ...layoutFixturePlugins(),
  ],

  themeConfig: {
    navbar: {
      title: 'Cardano DB Sync',
      items: [
        ...NAVBAR_MENU.map((item) => ({
          ...(item.href === NAVBAR_MENU[0].href
            ? {type: 'docSidebar' as const, sidebarId: 'docsSidebar'}
            : item.href === SURFACES.guides
              ? {type: 'doc' as const, docId: 'guides/index'}
              : {to: item.href}),
          label: item.label,
          position: 'left' as const,
        })),
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
      links: FOOTER_MENU.map((column) => ({
        title: column.title,
        items: column.items.map((item) => ({
          label: item.label,
          ...(item.href.startsWith('/')
            ? {to: item.href}
            : {
                href: item.href.replace(/^repository/, profile.repoUrl),
              }),
        })),
      })),
      copyright: `Cardano DB Sync is maintained by Intersect. Built ${new Date().getFullYear()}.`,
    },
    colorMode: {
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
