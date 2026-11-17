import type {BuildProfile} from '../../config/profiles';
import {validateFeed} from '../../src/updates/model';
import type {UpdateEntry, UpdatesFeed} from '../../src/updates/types';

const TITLE = 'Cardano DB Sync updates';
const DESCRIPTION = 'Releases, schema migrations and documentation changes from git history.';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';
const midnight = (date: string) => `${date}T00:00:00Z`;
const identity = (entry: UpdateEntry) => `${entry.url}#${entry.kind}`;

/** XML 1.0 text/attribute escaping, including invalid controls and lone surrogates. */
function xml(text: string): string {
  return Array.from(text)
    .filter((character) => {
      const point = character.codePointAt(0)!;
      return (
        point === 9 ||
        point === 10 ||
        point === 13 ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff)
      );
    })
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function rssFeed(value: UpdatesFeed, profile: BuildProfile): string {
  const feed = validateFeed(value);
  const page = `${profile.url}${profile.baseUrl}updates/`;
  const items = feed.entries
    .map(
      (entry) => `  <item>
    <title>${xml(entry.title)}</title>
    <link>${xml(entry.url)}</link>
    <guid isPermaLink="false">${xml(identity(entry))}</guid>
    <pubDate>${new Date(midnight(entry.date)).toUTCString()}</pubDate>
    <category>${entry.kind}</category>
  </item>`,
    )
    .join('\n');
  return `${DECLARATION}<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${TITLE}</title>
  <link>${xml(page)}</link>
  <description>${DESCRIPTION}</description>
  <language>en</language>
  <lastBuildDate>${new Date(midnight(feed.asOf)).toUTCString()}</lastBuildDate>
  <atom:link href="${xml(page)}rss.xml" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>\n`;
}

export function atomFeed(value: UpdatesFeed, profile: BuildProfile): string {
  const feed = validateFeed(value);
  const page = `${profile.url}${profile.baseUrl}updates/`;
  const entries = feed.entries
    .map(
      (entry) => `  <entry>
    <id>${xml(identity(entry))}</id>
    <title type="text">${xml(entry.title)}</title>
    <link rel="alternate" href="${xml(entry.url)}"/>
    <updated>${midnight(entry.date)}</updated>
    <summary type="text">${xml(entry.title)}</summary>
    <category term="${entry.kind}"/>
  </entry>`,
    )
    .join('\n');
  return `${DECLARATION}<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <id>${xml(page)}</id>
  <title type="text">${TITLE}</title>
  <subtitle type="text">${DESCRIPTION}</subtitle>
  <link rel="alternate" href="${xml(page)}"/>
  <link rel="self" type="application/atom+xml" href="${xml(page)}atom.xml"/>
  <updated>${midnight(feed.asOf)}</updated>
  <author><name>Cardano DB Sync contributors</name></author>
${entries}
</feed>\n`;
}
