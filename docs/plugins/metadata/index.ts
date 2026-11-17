import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {writeFile, readFile, rm} from 'node:fs/promises';
import {routeFile} from '../security';
import {metadataProblems} from '../../scripts/lib/metadata-validation.mjs';
import {resolveProfile} from '../../config/profiles';
import {docLocales} from '../i18n';
import {sitemapEntries, sitemapXml} from './sitemap';
import path from 'node:path';
import type {LoadedContent as DocsContent} from '@docusaurus/plugin-content-docs';
import type {LoadedContent as PagesContent} from '@docusaurus/plugin-content-pages';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {localePath} from '../../src/i18n/pages';
import {updatesFeed} from '../../src/updates/feed';
import {findTable} from '../../src/data/schema';
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
  context: Pick<LoadContext, 'siteDir' | 'baseUrl' | 'siteConfig' | 'i18n'>,
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
    `i18n/${context.i18n.currentLocale}/code.json`,
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
      ...(route === '/updates' && updatesFeed ? {feed: updatesFeed} : {}),
      ...(contentType(route, false) === 'Dataset'
        ? {variables: findTable(route.split('/').at(-1)!)?.columns.map((column) => column.name)}
        : {}),
      title: route === '/' ? context.siteConfig.title : (area ?? ''),
      description: '',
      breadcrumbs: [],
    };
    sources[route] = [
      source,
      ...(contentType(route, false) === 'Dataset' ? ['generated/schema.json'] : []),
      ...(area ? [`src/${area}`, `src/${route.slice(1).replaceAll('/', '-')}`] : ['src/landing']),
      ...dependencies,
    ];
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
  let translations: Record<string, string[]> = {};
  const profile = resolveProfile();
  return {
    name: METADATA_PLUGIN,
    allContentLoaded({allContent, actions}) {
      const docs = allContent['docusaurus-plugin-content-docs']?.default as DocsContent | undefined;
      translations = docs ? docLocales(docs, context) : {};
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
    async postBuild({outDir, routesPaths}) {
      const errors: string[] = [];
      for (const route of routesPaths) {
        const relative = localePath(route, context.baseUrl);
        const record = data.pages[relative];
        const page = routeFile(route, context.baseUrl);
        if (!record || !page) continue;
        const html = await readFile(path.join(outDir, page.file), 'utf8');
        errors.push(
          ...metadataProblems(html, record.type).map((error: string) => `${relative}: ${error}`),
        );
      }
      if (errors.length) throw new Error(`META-10: invalid metadata:\n${errors.join('\n')}`);
      const file = path.join(outDir, 'sitemap.xml');
      if (profile.indexable) {
        const entries = sitemapEntries({
          profile,
          baseUrl: context.baseUrl,
          currentLocale: context.i18n.currentLocale,
          defaultLocale: context.i18n.defaultLocale,
          locales: context.i18n.locales,
          pages: data.pages,
          translations,
          routesPaths,
        });
        await writeFile(file, sitemapXml(entries));
      } else await rm(file, {force: true});
      await emitSocialImages(
        outDir,
        Object.values(data.pages).map((page) => page.type),
      );
    },
  };
}
