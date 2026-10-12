import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {faqPageProblems} from '../../scripts/lib/faq-jsonld.mjs';
import {faqItems} from '../../src/landing/faq';
import {FAQ_IDS} from '../../src/faq/ids';
import {faqPageJsonLd, serializeJsonLd} from '../../src/faq/jsonld';
import {faqSections, guideUrl} from '../../src/faq/questions';

const english = ({message}: {message: string}) => message;
const sections = faqSections(english);
const entries = sections.flatMap((section) => section.items);

/** A page that shows the given questions, with the given JSON-LD blocks in its head. */
function page(blocks: string[], shown = entries): string {
  const head = blocks.map((block) => `<script type="application/ld+json">${block}</script>`);
  const body = shown.map(
    (item) => `<details><summary>${item.question}</summary><p>${item.answer}</p></details>`,
  );
  return `<html><head>${head.join('')}</head><body><main>${body.join('')}</main></body></html>`;
}

describe('FAQ questions (B44-c)', () => {
  it('carries every landing question and no question twice', () => {
    const keys = entries.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const {key} of faqItems(english)) {
      expect(keys).toContain(key);
    }
  });

  it('keeps operational limits beside the instructions', () => {
    const answer = (key: string) => entries.find((item) => item.key === key)!.answer;
    expect(answer('docker')).toContain('local development');
    expect(answer('docker')).toContain('not recommended for production');
    expect(answer('versions')).toContain('13.1.0.0');
    expect(answer('resync')).toContain('release notes');
    expect(answer('pgupgrade')).toContain('example');
    expect(answer('pgupgrade')).toContain('database size');
    expect(answer('portability')).not.toMatch(/^No\./);
  });

  it('links only guides the repository has', () => {
    const doc = path.resolve(import.meta.dirname, '../../../doc');
    const guides = entries.flatMap((item) => (item.guide ? [item.guide] : []));
    expect(guides.length).toBeGreaterThan(0);
    for (const guide of guides) expect(existsSync(path.join(doc, guide)), guide).toBe(true);
  });

  it('reads a guide on the repository default branch', () => {
    expect(guideUrl('https://github.com/o/r/', 'docker.md')).toBe(
      'https://github.com/o/r/blob/master/doc/docker.md',
    );
  });

  it('lists exactly the string ids the page renders (A11Y-18)', () => {
    const root = path.resolve(import.meta.dirname, '../../src');
    const files = [
      ...readdirSync(path.join(root, 'faq')).map((file) => path.join(root, 'faq', file)),
      path.join(root, 'pages', 'faq.tsx'),
      path.join(root, 'landing', 'faq.ts'),
    ];
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    const used = new Set(
      [...source.matchAll(/id: '((?:landing\.)?faq\.[^']+)'/g)].map((match) => match[1]),
    );
    expect([...FAQ_IDS].sort()).toEqual([...used].sort());
  });
});

describe('FAQPage JSON-LD (META-2)', () => {
  it('holds one Question per visible entry, with its answer', () => {
    const data = faqPageJsonLd(sections) as {mainEntity: unknown[]};
    expect(data['@type' as never]).toBe('FAQPage');
    expect(data.mainEntity).toHaveLength(entries.length);
    expect(data.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: entries[0].question,
      acceptedAnswer: {'@type': 'Answer', text: entries[0].answer},
    });
  });

  it('cannot close its script element early', () => {
    expect(serializeJsonLd({text: '</script><b>'})).toBe('{"text":"\\u003c/script>\\u003cb>"}');
    expect(JSON.parse(serializeJsonLd({text: '</script>'}))).toEqual({text: '</script>'});
  });

  it('passes the gate when it matches the page', () => {
    expect(faqPageProblems(page([serializeJsonLd(faqPageJsonLd(sections))]))).toEqual([]);
  });

  it('rejects malformed JSON roots without throwing', () => {
    for (const root of ['null', '[]', '42', '"FAQPage"', 'true']) {
      expect(faqPageProblems(page([root]))).toEqual(['JSON-LD must be an object']);
    }
  });

  it('requires exact question and answer pairs, in both directions', () => {
    const swapped = entries.map((item, index) => ({
      ...item,
      answer: entries[(index + 1) % entries.length].answer,
    }));
    expect(
      faqPageProblems(page([serializeJsonLd(faqPageJsonLd(sections))], swapped)).length,
    ).toBeGreaterThan(0);
    const subset = faqPageJsonLd([{...sections[0], items: [entries[0]]}]);
    expect(faqPageProblems(page([serializeJsonLd(subset)])).join(' ')).toContain(
      'missing from JSON-LD',
    );
  });

  it('does not count comments, hidden nodes, head or footer as shown FAQ answers', () => {
    const block = serializeJsonLd(faqPageJsonLd(sections));
    for (const body of [
      '<!--' + page([], entries) + '-->',
      '<div hidden>' + page([], entries) + '</div>',
      '<div aria-hidden="true">' + page([], entries) + '</div>',
      '<footer>' + page([], entries).replaceAll('main', 'div') + '</footer>',
    ]) {
      expect(faqPageProblems(page([block], []) + body).length).toBeGreaterThan(0);
    }
  });

  it('handles ordinary HTML attribute quoting and whitespace', () => {
    const html = page([serializeJsonLd(faqPageJsonLd(sections))])
      .replace('type="application/ld+json"', "type='application/ld+json'")
      .replace(
        `<summary>${entries[0].question}</summary>`,
        `<summary>${entries[0].question.replaceAll(' ', '\n')}</summary>`,
      );
    expect(faqPageProblems(html)).toEqual([]);
  });

  it('decodes the entities React writes before comparing', () => {
    const item = {key: 'x', question: 'Why "it" & <that>?', answer: "It's fine"};
    const block = serializeJsonLd(faqPageJsonLd([{id: 's', title: 's', items: [item]}]));
    const html = `<script type="application/ld+json">${block}</script><main><details><summary>Why &quot;it&quot; &amp; &lt;that&gt;?</summary><p>It&#x27;s fine</p></details></main>`;
    expect(faqPageProblems(html)).toEqual([]);
  });

  it('wants exactly one block of valid JSON', () => {
    expect(faqPageProblems(page([]))).toEqual([
      'expected exactly one JSON-LD block, found 0 (META-2)',
    ]);
    expect(faqPageProblems(page(['{}', '{}']))[0]).toMatch(/found 2/);
    expect(faqPageProblems(page(['{']))[0]).toMatch(/not valid JSON/);
  });

  it('wants a schema.org FAQPage with questions', () => {
    expect(faqPageProblems(page(['{"@context":"http://x","@type":"WebPage"}']))).toEqual([
      '@context must be https://schema.org, got "http://x"',
      '@type must be FAQPage, got "WebPage"',
      'mainEntity must be a non-empty array of Question',
    ]);
  });

  it('wants every question named, answered, unique and on the page', () => {
    const question = (name: unknown, text: unknown = 'answer') => ({
      '@type': 'Question',
      name,
      acceptedAnswer: {'@type': 'Answer', text},
    });
    const block = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {...question('Shown?'), '@type': 'Thing'},
        question(''),
        question('Shown?', ''),
        question('Shown?'),
        question('Hidden?'),
      ],
    });
    expect(
      faqPageProblems(
        `<script type="application/ld+json">${block}</script><main><details><summary>Shown?</summary><p>answer</p></details></main>`,
      ),
    ).toEqual([
      'mainEntity[0]: @type must be Question',
      'mainEntity[1]: name must be a non-empty string',
      'mainEntity[2]: duplicate question "Shown?"',
      'mainEntity[2]: acceptedAnswer must be an Answer with non-empty text',
      'mainEntity[3]: duplicate question "Shown?"',
      'mainEntity[4]: "Hidden?" is not on the page',
    ]);
  });

  it('flags an answer the page does not show', () => {
    const shown = entries.map((item, index) => (index ? item : {...item, answer: 'Changed.'}));
    expect(faqPageProblems(page([serializeJsonLd(faqPageJsonLd(sections))], shown))).toEqual([
      `mainEntity[0]: the answer to "${entries[0].question}" does not match its visible answer`,
    ]);
  });
});
