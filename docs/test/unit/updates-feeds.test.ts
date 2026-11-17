import {execFileSync} from 'node:child_process';
import {load} from 'cheerio';
import {describe, expect, it} from 'vitest';
import {PROFILES} from '../../config/profiles';
import {atomFeed, rssFeed} from '../../plugins/updates/xml';
import type {UpdatesFeed} from '../../src/updates/types';

const feed: UpdatesFeed = {
  asOf: '2026-01-06',
  entries: [
    {
      id: 'release:1.0.0.0',
      kind: 'release',
      date: '2026-01-05',
      title: 'Release 1.0.0.0',
      url: 'https://github.com/example/repo/tree/1.0.0.0',
    },
    {
      id: 'docs:abc',
      kind: 'docs',
      date: '2026-01-04',
      title: '<script>"&\'日本語 🚀\u0001</script>',
      url: 'https://github.com/example/repo/commit/abc?a=1&b=2',
    },
  ],
};

describe('RSS 2.0 and Atom 1.0 (R2, R3)', () => {
  for (const profile of Object.values(PROFILES)) {
    it(`emits profile-aware feeds matching the page dataset (${profile.name})`, () => {
      const rss = load(rssFeed(feed, profile), {xmlMode: true});
      const atom = load(atomFeed(feed, profile), {xmlMode: true});
      const base = `${profile.url}${profile.baseUrl}updates/`;
      expect(rss('rss').attr('version')).toBe('2.0');
      expect(rss('channel > title').text()).toBe('Cardano DB Sync updates');
      expect(rss('channel > description').text()).not.toBe('');
      expect(rss('channel > link').text()).toBe(base);
      expect(rss('channel > language').text()).toBe('en');
      expect(rss('channel > atom\\:link').attr('href')).toBe(`${base}rss.xml`);
      expect(rss('channel > atom\\:link').attr('rel')).toBe('self');
      expect(rss('item')).toHaveLength(feed.entries.length);
      expect(atom('feed').attr('xmlns')).toBe('http://www.w3.org/2005/Atom');
      expect(atom('feed > id').text()).toBe(base);
      expect(atom('feed > updated').text()).toBe('2026-01-06T00:00:00Z');
      expect(atom('feed > author > name').text()).not.toBe('');
      expect(atom('feed > link[rel="self"]').attr('href')).toBe(`${base}atom.xml`);
      expect(atom('entry')).toHaveLength(feed.entries.length);
      feed.entries.forEach((entry, i) => {
        const item = rss('item').eq(i),
          atomEntry = atom('entry').eq(i);
        expect(item.find('guid').attr('isPermaLink')).toBe('false');
        expect(item.find('guid').text()).toBe(atomEntry.find('id').text());
        expect(item.find('category').text()).toBe(entry.kind);
        expect(item.find('link').text()).toBe(entry.url);
        expect(atomEntry.find('link').attr('href')).toBe(entry.url);
        expect(new Date(item.find('pubDate').text()).toISOString().slice(0, 10)).toBe(entry.date);
        expect(atomEntry.find('updated').text()).toBe(`${entry.date}T00:00:00Z`);
        expect(item.find('title').text()).toBe(entry.title.replace('\u0001', ''));
        expect(atomEntry.find('title').text()).toBe(item.find('title').text());
      });
    });
  }
  it('escapes markup, removes illegal XML characters, and regenerates byte-identically', () => {
    for (const render of [rssFeed, atomFeed]) {
      const xml = render(feed, PROFILES.prod);
      execFileSync(
        'python3',
        ['-c', 'import sys, xml.etree.ElementTree as ET; ET.fromstring(sys.stdin.read())'],
        {input: xml},
      );
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).not.toContain('<script>');
      expect(xml).not.toContain('\u0001');
      expect(xml).toContain('日本語 🚀');
      expect(xml).toBe(render(feed, PROFILES.prod));
      expect(() =>
        render(
          {...feed, entries: [{...feed.entries[0], url: 'javascript:alert(1)'}]},
          PROFILES.prod,
        ),
      ).toThrow();
    }
  });
  it('supports a real empty pre-release feed and distinct schema/docs IDs on one commit', () => {
    expect(
      load(atomFeed({asOf: feed.asOf, entries: []}, PROFILES.dev), {xmlMode: true})('entry'),
    ).toHaveLength(0);
    expect(
      load(rssFeed({asOf: feed.asOf, entries: []}, PROFILES.dev), {xmlMode: true})('item'),
    ).toHaveLength(0);
    const mixed = {
      ...feed,
      entries: ['schema', 'docs'].map((kind) => ({
        ...feed.entries[0],
        id: kind + ':abc',
        kind: kind as 'schema' | 'docs',
        url: 'https://github.com/example/repo/commit/abc',
      })),
    };
    const atom = load(atomFeed(mixed, PROFILES.dev), {xmlMode: true});
    const ids = atom('entry > id')
      .map((_, e) => atom(e).text())
      .get();
    expect(new Set(ids).size).toBe(2);
    ids.forEach((id) => expect(new URL(id).protocol).toBe('https:'));
  });
});

it('bounded seeded XML property check preserves well-formedness across hostile Unicode', () => {
  let seed = 27;
  const alphabet = [
    '<',
    '>',
    '&',
    '"',
    "'",
    '\u0000',
    '\u000b',
    '\ud800',
    '\udfff',
    '\ufffe',
    '\uffff',
    '日',
    '🚀',
    'x',
    '\n',
    '\t',
  ];
  const documents: string[] = [];
  for (let sample = 0; sample < 64; sample++) {
    let title = 'Update ';
    for (let i = 0; i < 24; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      title += alphabet[(seed >>> 16) % alphabet.length];
    }
    const value = {...feed, entries: [{...feed.entries[0], title}]};
    documents.push(rssFeed(value, PROFILES.dev), atomFeed(value, PROFILES.dev));
  }
  execFileSync(
    'python3',
    [
      '-c',
      'import sys,json,xml.etree.ElementTree as ET; [ET.fromstring(s) for s in json.load(sys.stdin)]',
    ],
    {input: JSON.stringify(documents)},
  );
});
