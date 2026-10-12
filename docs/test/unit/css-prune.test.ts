import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import webpack from 'webpack';

import {describe, expect, it} from 'vitest';

import cssPrunePlugin, {
  contentTokens,
  cssPruneOptimization,
  pruneCss,
  selectorKept,
  usedBy,
} from '../../plugins/css-prune';

const used = usedBy(contentTokens(['<div class="navbar__link card_Ab12">', '"alert--"+type']));

describe('selectorKept (PERF-1)', () => {
  it('keeps a selector only when the build mentions every class it needs', () => {
    expect(selectorKept('.navbar__link:hover', used)).toBe(true);
    expect(selectorKept('.card_Ab12 > .navbar__link', used)).toBe(true);
    expect(selectorKept('.pagination-nav__link', used)).toBe(false);
    expect(selectorKept('.navbar__link .pagination', used)).toBe(false);
  });

  it('does not mistake dots in attribute values for classes', () => {
    expect(selectorKept('.navbar__link[href$=".pdf"]', used)).toBe(true);
  });

  it('keeps escaped class selectors mentioned by their actual class name', () => {
    expect(selectorKept('.sm\\:block', usedBy(new Set(['sm:block'])))).toBe(true);
  });

  it('keeps names built by concatenation from a mentioned prefix', () => {
    expect(selectorKept('.alert--danger', used)).toBe(true);
  });

  it('does not require a class that is negated or optional', () => {
    expect(selectorKept('.navbar__link:not(.navbar__link--active)', used)).toBe(true);
    expect(selectorKept('.card_Ab12:is(.unused, .other)', used)).toBe(true);
  });

  it('keeps element, attribute and root selectors, and drops inventory demo states', () => {
    expect(selectorKept(':root[data-theme="dark"]', used)).toBe(true);
    expect(selectorKept('svg[data-dbs-icon-sprite]', used)).toBe(true);
    expect(selectorKept(".card_Ab12[data-dbs-demo='hover']", used)).toBe(false);
  });
});

describe('pruneCss', () => {
  it('drops unmatched selectors, empty rules and empty at-rules, and nothing else', () => {
    const css = [
      '.navbar__link,.pagination{color:red}',
      '.pagination{margin:0}',
      '@media (min-width:1px){.pagination{margin:0}}',
      '@keyframes spin{from{opacity:0}to{opacity:1}}',
      '@font-face{font-family:x;src:url(x.woff2)}',
    ].join('');
    const result = pruneCss(css, used);
    expect(result.removed).toBe(3);
    expect(result.css).toBe(
      '.navbar__link{color:red}@keyframes spin{from{opacity:0}to{opacity:1}}@font-face{font-family:x;src:url(x.woff2)}',
    );
  });
});

describe('CSS cache identity', () => {
  it('changes the CSS asset URL when pruning changes its bytes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'css-cache-'));
    try {
      await fs.writeFile(path.join(dir, 'theme.css'), '.one{color:red}.two{color:blue}');
      const names: string[] = [];
      for (const name of ['one', 'two']) {
        await fs.writeFile(
          path.join(dir, 'entry.js'),
          `import asset from './theme.css'; console.log(asset, '${name}');`,
        );
        await new Promise<void>((resolve, reject) => {
          const compiler = webpack({
            mode: 'production',
            entry: path.join(dir, 'entry.js'),
            output: {
              path: path.join(dir, name),
              filename: 'main.js',
              assetModuleFilename: 'assets/css/[name].[contenthash].css',
            },
            module: {rules: [{test: /\.css$/, type: 'asset/resource'}]},
            plugins: [cssPruneOptimization],
          });
          compiler.run((error, stats) =>
            compiler.close(() => {
              if (error || stats?.hasErrors()) reject(error ?? new Error(stats?.toString()));
              else resolve();
            }),
          );
        });
        const [asset] = await fs.readdir(path.join(dir, name, 'assets', 'css'));
        names.push(asset);
        expect(await fs.readFile(path.join(dir, name, 'assets', 'css', asset), 'utf8')).toBe(
          name === 'one' ? '.one{color:red}' : '.two{color:blue}',
        );
        expect(await fs.readFile(path.join(dir, name, 'main.js'), 'utf8')).toContain(asset);
      }
      expect(names[0]).not.toBe(names[1]);
      expect(cssPrunePlugin().postBuild).toBeUndefined();
    } finally {
      await fs.rm(dir, {recursive: true, force: true});
    }
  });
});
