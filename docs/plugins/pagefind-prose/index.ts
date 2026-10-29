import path from 'node:path';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import type {LoadedContent} from '@docusaurus/plugin-content-docs';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {versionSegment} from '../../src/search/version';

type Version = {versionName: string; docs: readonly {permalink: string}[]};
type Errors = {errors: string[]};
type Index = {
  addHTMLFile: (file: {url: string; content: string}) => Promise<Errors>;
  writeFiles: (options: {outputPath: string}) => Promise<Errors>;
  deleteIndex: () => Promise<unknown>;
};
type Create = () => Promise<{errors: string[]; index?: Index}>;

function check(errors: string[]): void {
  if (errors.length) throw new Error(`Pagefind: ${errors.join('; ')}`);
}

/** Index the rendered documentation, not navigation, retired redirects, or other versions. */
export async function indexVersions(options: {
  outDir: string;
  baseUrl: string;
  versions: readonly Version[];
  create: Create;
  read: (file: string) => Promise<string>;
}): Promise<void> {
  const {outDir, baseUrl, versions, create, read} = options;
  for (const version of versions) {
    const name = versionSegment(version.versionName);
    const result = await create();
    check(result.errors);
    if (!result.index) throw new Error('Pagefind did not create an index');
    const index = result.index;
    try {
      for (const doc of version.docs) {
        if (!doc.permalink.startsWith(baseUrl))
          throw new Error(`Invalid doc URL: ${doc.permalink}`);
        const relative = doc.permalink.slice(baseUrl.length);
        const segments = relative.split('/').filter(Boolean);
        if (segments.some((segment) => segment === '.' || segment === '..'))
          throw new Error(`Invalid doc URL: ${doc.permalink}`);
        const content = await read(path.join(outDir, ...segments, 'index.html'));
        check((await index.addHTMLFile({url: doc.permalink, content})).errors);
      }
      const outputPath = path.join(outDir, 'pagefind', name);
      check((await index.writeFiles({outputPath})).errors);
      // Pagefind emits three optional UI implementations and a highlighter by default. This
      // integration is headless; none is loaded, and retaining them breaks the asset budget.
      await Promise.all(
        [
          'pagefind-ui.js',
          'pagefind-ui.css',
          'pagefind-modular-ui.js',
          'pagefind-modular-ui.css',
          'pagefind-component-ui.js',
          'pagefind-component-ui.css',
          'pagefind-highlight.js',
        ].map((file) => fs.rm(path.join(outputPath, file), {force: true})),
      );
    } finally {
      await index.deleteIndex();
    }
  }
}

export default function pagefindProse(context: LoadContext): Plugin {
  let versions: Version[] = [];
  return {
    name: 'pagefind-prose',
    allContentLoaded({allContent}) {
      const docs = allContent['docusaurus-plugin-content-docs']?.default as
        LoadedContent | undefined;
      if (!docs) throw new Error('Pagefind requires the default docs plugin');
      versions = docs.loadedVersions;
    },
    async postBuild({outDir, baseUrl}) {
      const requireFromSite = createRequire(path.join(context.siteDir, 'package.json'));
      const loadPagefind = requireFromSite(
        path.join(context.siteDir, 'plugins/pagefind-prose/load.cjs'),
      ) as () => Promise<typeof import('pagefind')>;
      const pagefind = await loadPagefind();
      try {
        await indexVersions({
          outDir,
          baseUrl,
          versions,
          create: () => pagefind.createIndex({rootSelector: 'article .markdown'}),
          read: (file) => fs.readFile(file, 'utf8'),
        });
      } finally {
        await pagefind.close();
      }
    },
  };
}
