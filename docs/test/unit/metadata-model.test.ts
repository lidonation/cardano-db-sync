import {describe, expect, it} from 'vitest';
import {breadcrumbJsonLd, contentJsonLd, contentType, socialImage} from '../../src/metadata/model';
import {CONTENT_TYPES, type ContentMetadata} from '../../src/metadata/types';
import {generateSocialImage} from '../../plugins/metadata/images';
import {loadSchema} from '../../src/data/schema';
import sharp from 'sharp';
const url = 'https://docs.example.test/docs/13.5/guide';
const base: ContentMetadata = {
  type: 'TechArticle',
  title: 'Title',
  description: 'A lead.',
  version: '13.5',
};
describe('content metadata templates (META-1..3, META-5)', () => {
  it('selects from actual route/doc identity, not a newest-version rewrite', () => {
    expect(contentType('/docs/13.5/guides/install', true, 'guides/install')).toBe('HowTo');
    expect(contentType('/docs/13.5/reference', true, 'reference')).toBe('TechArticle');
    expect(contentType('/docs/guides', true, 'guides/index')).toBe('WebPage');
    expect(contentType('/docs/guides', true, 'guides')).toBe('HowTo');
    for (const [route, type] of [
      ['/', 'SoftwareSourceCode'],
      ['/faq', 'FAQPage'],
      ['/updates', 'DataFeed'],
      ['/config', 'WebApplication'],
      ['/schema/tx_out', 'Dataset'],
      ['/numbers', 'WebPage'],
    ])
      expect(contentType(route, false)).toBe(type);
    expect(socialImage('HowTo', '/prefix/')).toBe('/prefix/social/HowTo.webp');
  });
  it('emits one schema.org content type with its own canonical URL', () => {
    const data = contentJsonLd(base, url, 'https://github.com/example/db-sync');
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      url,
      name: 'Title',
      description: 'A lead.',
      version: '13.5',
    });
    expect(
      contentJsonLd(
        {...base, type: 'SoftwareSourceCode'},
        url,
        'https://github.com/example/db-sync',
      ),
    ).toHaveProperty('codeRepository', 'https://github.com/example/db-sync');
  });
  it('uses artifact columns for Dataset, and actual steps/items for HowTo/DataFeed', () => {
    const table = loadSchema().tables.find((item) => item.name === 'block')!;
    const columns = table.columns.map((item) => item.name);
    const data = contentJsonLd(
      {...base, type: 'Dataset', variables: columns},
      url,
      'https://repo.test',
    );
    expect(data).toHaveProperty(
      'variableMeasured',
      columns.map((name) => ({'@type': 'PropertyValue', name})),
    );
    expect(
      contentJsonLd(
        {...base, type: 'HowTo', steps: [{name: 'Prepare', text: 'Select a release.'}]},
        url,
        'https://repo.test',
      ),
    ).toHaveProperty('step', [{'@type': 'HowToStep', name: 'Prepare', text: 'Select a release.'}]);
    expect(contentJsonLd({...base, type: 'DataFeed'}, url, 'https://repo.test')).not.toHaveProperty(
      'dataFeedElement',
    );
    expect(
      contentJsonLd({...base, type: 'WebApplication'}, url, 'https://repo.test'),
    ).toMatchObject({applicationCategory: 'DeveloperApplication', operatingSystem: 'Any'});
    // FAQ has its own visible-question producer; never emit a second FAQPage.
    expect(contentJsonLd({...base, type: 'FAQPage'}, url, 'https://repo.test')).toBeNull();
  });
  it('breadcrumbs use published route labels and preserve version + locale', () => {
    expect(
      breadcrumbJsonLd(
        [
          {name: 'Home', path: '/ja/'},
          {name: 'Install', path: '/ja/docs/13.5/install'},
        ],
        'https://docs.test',
      ),
    ).toMatchObject({
      '@type': 'BreadcrumbList',
      itemListElement: [
        {'@type': 'ListItem', position: 1, name: 'Home', item: 'https://docs.test/ja/'},
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Install',
          item: 'https://docs.test/ja/docs/13.5/install',
        },
      ],
    });
  });
});
it('generates deterministic 1200x630 modern social images per content type with no text (META-9, PERF-2)', async () => {
  const outputs = [];
  for (const type of CONTENT_TYPES) {
    const image = await generateSocialImage(type);
    expect(image.equals(await generateSocialImage(type))).toBe(true);
    expect(await sharp(image).metadata()).toMatchObject({width: 1200, height: 630, format: 'webp'});
    expect(image.byteLength).toBeLessThan(20_000);
    outputs.push(image.toString('base64'));
  }
  expect(new Set(outputs).size).toBe(CONTENT_TYPES.length);
});

it('derives DataFeed items from the same available feed snapshot, preserving missing-vs-empty', () => {
  const feed = {
    asOf: '2026-10-01',
    entries: [
      {
        id: 'one',
        date: '2026-09-30',
        kind: 'release' as const,
        title: 'Release',
        url: 'https://repo.test/release',
      },
    ],
  };
  expect(contentJsonLd({...base, type: 'DataFeed', feed}, url, 'https://repo.test')).toMatchObject({
    dateModified: feed.asOf,
    dataFeedElement: [
      {
        '@type': 'DataFeedItem',
        dateCreated: '2026-09-30',
        item: {'@type': 'CreativeWork', name: 'Release', url: 'https://repo.test/release'},
      },
    ],
  });
  expect(contentType('/docs/guides', true, 'guides/index')).toBe('WebPage');
});
