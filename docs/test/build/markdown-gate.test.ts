import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import {afterEach, describe, expect, it} from 'vitest';

const run = promisify(execFile);
const DOCS_ROOT = path.resolve(import.meta.dirname, '../..');
/**
 * The filename must not start with an underscore. Docusaurus treats `_*.md` as a partial and
 * excludes it from the build, so an underscored fixture silently proves nothing.
 */
const BROKEN_PAGE = path.join(DOCS_ROOT, 'docs', 'broken-markdown-fixture.md');

/**
 * B01 DoD: a deliberately broken Markdown file fails the build.
 *
 * The unclosed angle bracket below is exactly what CON-8 forbids in authored content: with
 * `markdown.format` at its `mdx` default (CON-9), MDX reads it as a JSX tag and refuses to
 * compile. If this test ever passes a build, the parser gate is no longer live.
 */
const BROKEN_CONTENT = `---
title: Broken fixture
---

# Broken fixture

This line contains an unclosed <NotAComponent which MDX cannot compile.
`;

afterEach(async () => {
  await fs.rm(BROKEN_PAGE, {force: true});
});

describe('the Markdown parser gate is live', () => {
  it('fails the build on a Markdown file MDX cannot compile', async () => {
    await fs.writeFile(BROKEN_PAGE, BROKEN_CONTENT, 'utf8');

    let failed = false;
    let output = '';

    try {
      await run('npm', ['run', 'build:dev'], {cwd: DOCS_ROOT, maxBuffer: 64 * 1024 * 1024});
    } catch (error) {
      failed = true;
      const e = error as {stdout?: string; stderr?: string};
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }

    expect(failed, 'the build accepted a Markdown file MDX cannot compile').toBe(true);
    expect(output).toContain('broken-markdown-fixture');
  }, 900_000);

  it('builds clean again once the broken file is gone', async () => {
    await fs.rm(BROKEN_PAGE, {force: true});
    const {stdout} = await run('npm', ['run', 'build:dev'], {
      cwd: DOCS_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(stdout).toContain('Generated static files');
  }, 900_000);
});
