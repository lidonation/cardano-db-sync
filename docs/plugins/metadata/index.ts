import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {LoadedContent as DocsContent} from '@docusaurus/plugin-content-docs';
import type {LoadedContent as PagesContent} from '@docusaurus/plugin-content-pages';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {localePath} from '../../src/i18n/pages';
import {contentType} from '../../src/metadata/model';
import {METADATA_PLUGIN, type MetadataData, type RouteMetadata} from '../../src/metadata/types';
import {FRONTMATTER} from '../../scripts/lib/frontmatter.mjs';
import {deriveMetadata} from './markdown.mjs';
import {emitSocialImages} from './images';

/** Committed dependency time, not build time. Fixtures without a git checkout omit it. */
export function gitLastmod(siteDir: string, sources: readonly string[]): string | undefined {
  try {
    const value = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...sources], {
      cwd: siteDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^\d{4}-\d\d-\d\dT/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function buildMetadata(
  context: Pick<LoadContext, 'siteDir' | 'baseUrl' | 'siteConfig'>,
  docs: DocsContent | undefined,
  pages: PagesContent = [],
): MetadataData {
  const records: Record<string, RouteMetadata> = {};
  const sources: Record<string, string[]> = {};
  const dependencies = [
    'plugins/metadata',
    'src/metadata',
    'src/theme/SiteMetadata',
    'docusaurus.config.ts',
  ];
  for (const version of docs?.loadedVersions ?? []) {
    for (const doc of version.docs) {
      const route = localePath(doc.permalink, context.baseUrl);
      const file = doc.source.startsWith('@site/')
        ? path.join(context.siteDir, doc.source.slice(6))
        : doc.source;
      const derived = deriveMetadata(
        readFileSync(file, 'utf8').replace(FRONTMATTER, ''),
        doc.title,
      );
      records[route] = {
        type: contentType(route, true, doc.id),
        title: doc.title,
        description: doc.description,
        version: version.versionName,
        ...(doc.id.startsWith('guides/') ? {steps: derived.steps} : {}),
        breadcrumbs: [],
      };
      sources[route] = [path.relative(context.siteDir, file), 'sidebars.ts', ...dependencies];
    }
  }
  for (const page of pages) {
    const route = localePath(page.permalink, context.baseUrl);
    const source = page.source.startsWith('@site/') ? page.source.slice(6) : page.source;
    const area = route.split('/').filter(Boolean)[0];
    records[route] = {
      type: contentType(route, false),
      title: route === '/' ? context.siteConfig.title : (area ?? ''),
      description: '',
      breadcrumbs: [],
    };
    sources[route] = [source, ...(area ? [`src/${area}`] : ['src/landing']), ...dependencies];
  }
  for (const [route, record] of Object.entries(records)) {
    const segments = route.split('/').filter(Boolean);
    const ancestors = segments
      .map((_, i) => `/${segments.slice(0, i + 1).join('/')}`)
      .filter((item) => records[item]);
    const breadcrumbs = [
      {name: context.siteConfig.title, path: context.baseUrl},
      ...ancestors.map((item) => ({
        name: records[item].title,
        path: context.baseUrl + item.slice(1),
      })),
    ];
    records[route] = {...record, breadcrumbs, lastmod: gitLastmod(context.siteDir, sources[route])};
  }
  return {pages: records};
}

export default function metadataPlugin(context: LoadContext): Plugin {
  let data: MetadataData = {pages: {}};
  return {
    name: METADATA_PLUGIN,
    allContentLoaded({allContent, actions}) {
      data = buildMetadata(
        context,
        allContent['docusaurus-plugin-content-docs']?.default as DocsContent | undefined,
        allContent['docusaurus-plugin-content-pages']?.default as PagesContent | undefined,
      );
      actions.setGlobalData({
        pages: Object.fromEntries(
          Object.entries(data.pages)
            .filter(([, page]) => !page.version)
            .map(([route, page]) => [route, {...page, lastmod: undefined}]),
        ),
      });
    },
    async postBuild({outDir}) {
      await emitSocialImages(
        outDir,
        Object.values(data.pages).map((page) => page.type),
      );
    },
  };
}
