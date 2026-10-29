import {expect, it} from 'vitest';
import {validateRenderedGuide} from '../../plugins/static-guide-content/validate';

it('accepts supported rendered guide markup and safe links', () => {
  const html =
    '<div data-static-guide="guides/a" data-static-permalink="/docs/guides/a"><div class="markdown"><h2 id="intro">Intro</h2><p><a href="https://example.org">Safe</a></p><pre class="theme-code-block"><code>select 1</code></pre></div></div>';
  expect(validateRenderedGuide(html)).toEqual([]);
});

it('rejects executable links, inline event handlers and unsupported content', () => {
  const html =
    '<div data-static-guide="guides/a" data-static-permalink="/docs/guides/a"><p onclick="alert(1)"><a href="javascript:alert(1)">bad</a></p><script>alert(1)</script></div>';
  const errors = validateRenderedGuide(html).join('\n');
  expect(errors).toContain('onclick');
  expect(errors).toContain('javascript');
  expect(errors).toContain('script');
});

it('rejects target-blank links without opener protection', () => {
  expect(
    validateRenderedGuide(
      '<div data-static-guide="guides/a" data-static-permalink="/docs/guides/a"><a target="_blank" href="https://example.org">x</a></div>',
    ).join(),
  ).toContain('noopener');
});

it('rejects malformed route identity on optimized content', () => {
  expect(
    validateRenderedGuide(
      '<div data-static-guide="guides/a" data-static-permalink="https://evil.test/docs/guides/a"><p>x</p></div>',
    ).join(),
  ).toContain('route identity');
  expect(
    validateRenderedGuide('<div data-static-guide="guides/a"><p>x</p></div>').join(),
  ).toContain('route identity');
});

it('rejects invalid optimized markup during post-build', async () => {
  const {mkdtemp, mkdir, writeFile, rm} = await import('node:fs/promises');
  const {default: os} = await import('node:os');
  const {default: path} = await import('node:path');
  const {default: plugin} = await import('../../plugins/static-guide-content');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'static-guard-'));
  try {
    await mkdir(path.join(dir, 'docs'), {recursive: true});
    await writeFile(
      path.join(dir, 'docs', 'bad.html'),
      '<div data-static-guide="guides/a" data-static-permalink="/docs/guides/a"><script>bad()</script></div>',
    );
    const check = plugin({siteDir: dir} as never).postBuild!;
    await expect(check({outDir: dir} as never)).rejects.toThrow(/Unsupported guide tag script/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

it('requires an actual rel token, not a prefix or suffix', () => {
  const bad =
    '<div data-static-guide="guides/a" data-static-permalink="/docs/guides/a"><a target="_blank" rel="noopener-evil" href="https://example.org">x</a></div>';
  expect(validateRenderedGuide(bad).join()).toContain('noopener');
  const safe = bad.replace('noopener-evil', 'nofollow noopener');
  expect(validateRenderedGuide(safe)).toEqual([]);
});

it('accepts current and version-prefixed documentation routes without allowing a different guide', () => {
  const markup = (url: string) =>
    `<div data-static-guide="guides/a" data-static-permalink="${url}"><p>x</p></div>`;
  expect(validateRenderedGuide(markup('/docs/guides/a'))).toEqual([]);
  expect(validateRenderedGuide(markup('/cardano-db-sync/ja/docs/next/guides/a'))).toEqual([]);
  expect(validateRenderedGuide(markup('/cardano-db-sync/docs/13.6/guides/a'))).toEqual([]);
  expect(validateRenderedGuide(markup('/docs/next/guides/b')).join()).toContain('route identity');
  expect(validateRenderedGuide(markup('/other/guides/a')).join()).toContain('route identity');
});
