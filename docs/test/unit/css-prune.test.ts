import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import cssPrunePlugin, {
  contentTokens,
  pruneBuild,
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

describe('pruneBuild', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await fs.rm(dir, {recursive: true, force: true});
  });

  it('prunes the build stylesheets against its own pages and scripts', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'css-prune-'));
    await fs.mkdir(path.join(dir, 'assets', 'css'), {recursive: true});
    await fs.mkdir(path.join(dir, 'assets', 'js'), {recursive: true});
    await fs.writeFile(path.join(dir, 'index.html'), '<main class="hero_x1Y2"></main>');
    await fs.writeFile(path.join(dir, 'assets', 'js', 'main.js'), 'c("button_Zz99")');
    await fs.writeFile(
      path.join(dir, 'assets', 'css', 'styles.css'),
      '.hero_x1Y2{a:b}.button_Zz99{c:d}.menu__list{e:f}',
    );
    await cssPrunePlugin().postBuild?.({outDir: dir} as never);
    expect(await fs.readFile(path.join(dir, 'assets', 'css', 'styles.css'), 'utf8')).toBe(
      '.hero_x1Y2{a:b}.button_Zz99{c:d}',
    );
    expect(await pruneBuild(dir)).toBe(0);
  });
});
