import {describe, expect, it} from 'vitest';
import {metadataProblems, jsonLdProblems} from '../../scripts/lib/metadata-validation.mjs';
import {contentJsonLd, breadcrumbJsonLd} from '../../src/metadata/model';
import {CONTENT_TYPES} from '../../src/metadata/types';
const base = {
  title: 'A title',
  description: 'A description',
  steps: [{name: 'Prepare', text: 'Pick a release.'}],
  variables: ['id'],
};
const crumb = breadcrumbJsonLd([{name: 'Home', path: '/'}], 'https://docs.test');
const html = (data: unknown) =>
  `<html><head><title>A title</title><meta name="description" content="A description"><script type="application/ld+json">${JSON.stringify(data)}</script><script type="application/ld+json">${JSON.stringify(crumb)}</script></head><body><main><h1>A title</h1></main></body></html>`;
describe('schema.org template validation (META-10)', () => {
  it('accepts each complete content template', () => {
    for (const type of CONTENT_TYPES.filter((type) => type !== 'FAQPage')) {
      const data = contentJsonLd({...base, type}, 'https://docs.test/page', 'https://repo.test');
      expect(jsonLdProblems(data), type).toEqual([]);
      expect(metadataProblems(html(data)), type).toEqual([]);
    }
  });
  it('rejects wrong root type/context, missing fields, invalid nested structures and unsafe URLs', () => {
    for (const bad of [
      null,
      [],
      {},
      {'@type': 'Invented'},
      {'@context': 'http://schema.org', '@type': 'WebPage'},
      {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: 'X',
        description: 'Y',
        url: 'javascript:alert(1)',
        variableMeasured: [{name: ''}],
      },
      {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: 'X',
        description: 'Y',
        url: 'https://docs.test',
        step: [{'@type': 'HowToStep', name: ''}],
      },
    ])
      expect(jsonLdProblems(bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
    expect(
      jsonLdProblems({
        ...crumb,
        itemListElement: [{'@type': 'ListItem', position: 8, name: 'X', item: 'bad'}],
      }).join(),
    ).toMatch(/position|URL/);
  });
  it('fails closed on malformed JSON, missing/duplicate blocks, mismatched content and heading count', () => {
    const data = contentJsonLd(
      {...base, type: 'TechArticle'},
      'https://docs.test/page',
      'https://repo.test',
    )!;
    const valid = html(data);
    for (const bad of [
      valid.replace('"@context"', 'BROKEN'),
      valid.replaceAll('application/ld+json', 'text/plain'),
      valid.replace(
        '</head>',
        `<script type="application/ld+json">${JSON.stringify(data)}</script></head>`,
      ),
      valid.replace('content="A description"', 'content="wrong"'),
      valid.replace('</main>', '<h1>Second</h1></main>'),
    ])
      expect(metadataProblems(bad).length).toBeGreaterThan(0);
    expect(metadataProblems(valid, 'HowTo').join()).toMatch(/HowTo/);
  });
  it('validates feed items and never accepts a fake complete FAQ', () => {
    const feed = contentJsonLd(
      {...base, type: 'DataFeed'},
      'https://docs.test/page',
      'https://repo.test',
    )!;
    expect(
      jsonLdProblems({
        ...feed,
        dataFeedElement: [
          {
            '@type': 'DataFeedItem',
            dateCreated: 'yesterday',
            item: {'@type': 'CreativeWork', name: '', url: 'http://unsafe.test'},
          },
        ],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      jsonLdProblems({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {'@type': 'Question', name: 'Q', acceptedAnswer: {'@type': 'Answer', text: ''}},
        ],
      }).length,
    ).toBeGreaterThan(0);
  });
});
