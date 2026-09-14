import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

import {resolveProfile} from './config/profiles';
import cnamePlugin from './plugins/cname';

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

  organizationName: 'IntersectMBO',
  projectName: 'cardano-db-sync',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  // Exposed to pages and components so no surface re-derives the environment (ENV-1, ENV-2).
  customFields: {
    profile,
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

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
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [cnamePlugin],

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
