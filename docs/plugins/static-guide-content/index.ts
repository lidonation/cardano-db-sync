import path from 'node:path';
import {readFile, readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {validateRenderedGuide} from './validate';
import type {LoadContext, Plugin} from '@docusaurus/types';
import type {PathData} from 'webpack';
import staticGuides from '../../data/static-guides.json';

type MarkdownNode = {type: string; meta?: string | null; children?: MarkdownNode[]};
/** Conservatively keep guides containing tabbed procedures on the native MDX path. */
export function hasProcedureTabs(source: string): boolean {
  const tree = unified().use(remarkParse).parse(source) as MarkdownNode;
  function visit(node: MarkdownNode): boolean {
    return (
      (node.type === 'code' && /^tab="[^"\n]+"$/.test(node.meta?.trim() ?? '')) ||
      (node.children?.some(visit) ?? false)
    );
  }
  return visit(tree);
}

/** Optimize only explicitly reviewed current guides; new and versioned documents stay native. */
export default function staticGuidePlugin(context: LoadContext): Plugin {
  const directory = path.resolve(context.siteDir, 'docs/guides');
  return {
    name: 'static-guide-content',
    async postBuild({outDir}) {
      const errors: string[] = [];
      async function walk(dir: string): Promise<void> {
        for (const entry of await readdir(dir, {withFileTypes: true})) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'assets') await walk(file);
          } else if (entry.isFile() && entry.name.endsWith('.html')) {
            const html = await readFile(file, 'utf8');
            if (html.includes('data-static-guide')) {
              for (const error of validateRenderedGuide(html))
                errors.push(`${path.relative(outDir, file)}: ${error}`);
            }
          }
        }
      }
      await walk(outDir);
      if (errors.length)
        throw new Error(`Static guide markup is unsafe or unsupported:\n${errors.join('\n')}`);
    },
    configureWebpack(config) {
      if (config.mode !== 'production') return {};
      const active = staticGuides.filter(
        (name) => !hasProcedureTabs(readFileSync(path.join(directory, `${name}.md`), 'utf8')),
      );
      const known = new Set(active.map((name) => path.join(directory, `${name}.md`)));
      const names = new Set(active);
      const metadataDir = path.resolve(
        context.siteDir,
        '.docusaurus/docusaurus-plugin-content-docs/default',
      );
      return {
        output: {
          chunkFilename: (data: PathData) =>
            data.chunk?.name && /^[a-f0-9]{8}$/.test(data.chunk.name)
              ? 'assets/js/[contenthash:16].js'
              : 'assets/js/[name].[contenthash:8].js',
        },
        module: {
          rules: [
            {
              test: (resource: string) => known.has(path.resolve(resource)),
              enforce: 'post',
              use: [path.resolve(context.siteDir, 'plugins/static-guide-content/loader.mjs')],
            },
          ],
        },
        optimization: {
          splitChunks: {
            cacheGroups: {
              guideMetadata: {
                name: 'guide-metadata',
                test: (module: unknown) => {
                  if (
                    !module ||
                    typeof module !== 'object' ||
                    !('resource' in module) ||
                    typeof module.resource !== 'string'
                  )
                    return false;
                  const resource = path.resolve(module.resource);
                  if (known.has(resource)) return true;
                  if (path.dirname(resource) !== metadataDir) return false;
                  const match = /^site-docs-guides-(.+)-md-[a-f0-9]+\.json$/.exec(
                    path.basename(resource),
                  );
                  return Boolean(match && names.has(match[1]));
                },
                chunks: 'async',
                minChunks: 1,
                minSize: 0,
                enforce: true,
                priority: 65,
              },
              staticGuide: {
                name: 'static-guide',
                test: /[/\\]src[/\\]components[/\\]StaticGuide[/\\]/,
                chunks: 'async',
                minChunks: 1,
                minSize: 0,
                enforce: true,
                priority: 60,
              },
            },
          },
        },
      };
    },
  };
}
