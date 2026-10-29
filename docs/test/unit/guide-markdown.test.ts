import {describe, expect, it} from 'vitest';
import guideMarkdown from '../../plugins/guide-markdown/index.mjs';

type Node = {type: string; children?: Node[]; [key: string]: unknown};
const code = (label: string, value = 'command'): Node => ({
  type: 'code',
  lang: 'sh',
  meta: `tab="${label}"`,
  value,
});
const run = (children: Node[]) => {
  const tree: Node = {type: 'root', children};
  guideMarkdown()(tree);
  return tree.children!;
};

describe('CommonMark guide upgrades (CON-10)', () => {
  it('upgrades adjacent labelled fences, preserving source order and code', () => {
    const out = run([
      code('Docker', 'docker run'),
      code('nix', 'nix run'),
      code('cabal', 'cabal run'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({type: 'mdxJsxFlowElement', name: 'ProcedureTabs'});
    expect(out[0].children?.map((n) => n.attributes)).toEqual([
      [{type: 'mdxJsxAttribute', name: 'label', value: 'Docker'}],
      [{type: 'mdxJsxAttribute', name: 'label', value: 'nix'}],
      [{type: 'mdxJsxAttribute', name: 'label', value: 'cabal'}],
    ]);
    expect(out[0].children?.map((n) => n.children?.[0].value)).toEqual([
      'docker run',
      'nix run',
      'cabal run',
    ]);
  });
  it('leaves lone, unlabelled, malformed or duplicate-labelled fences alone', () => {
    const single = code('Docker');
    expect(run([single])).toEqual([single]);
    const dup = [code('same'), code('same')];
    expect(run(dup)).toEqual(dup);
    const malformed = [code('one'), {type: 'code', lang: 'sh', meta: 'tab=""', value: 'x'}];
    expect(run(malformed)).toEqual(malformed);
  });
  it('upgrades GitHub alerts while preserving their prose', () => {
    const paragraph: Node = {
      type: 'paragraph',
      children: [{type: 'text', value: '[!NOTE]\nPay attention.'}],
    };
    const out = run([{type: 'blockquote', children: [paragraph]}]);
    expect(out[0]).toMatchObject({
      type: 'mdxJsxFlowElement',
      name: 'GuideAlert',
      attributes: [{type: 'mdxJsxAttribute', name: 'kind', value: 'note'}],
    });
    expect(out[0].children?.[0].children?.[0].value).toBe('Pay attention.');
  });
  it('does not turn ordinary quotations into alerts', () => {
    const quote: Node = {
      type: 'blockquote',
      children: [{type: 'paragraph', children: [{type: 'text', value: 'ordinary quote'}]}],
    };
    expect(run([quote])).toEqual([quote]);
  });
});

it('uses theme-token callout surfaces instead of unthemed alert colors', async () => {
  const {readFileSync} = await import('node:fs');
  const {default: path} = await import('node:path');
  const css = readFileSync(
    path.resolve(import.meta.dirname, '../../src/components/GuideMarkdown/styles.module.css'),
    'utf8',
  );
  expect(css).toContain('--dbs-status-warning-subtle');
  expect(css).toContain('--dbs-status-danger-subtle');
  expect(css).toContain('--dbs-surface-accent-subtle');
  expect(css).toContain('--dbs-border-width-hairline');
});
