import type {PageMessage} from '../i18n/pageTranslator';
import {faqItems, type FaqItem} from '../landing/faq';

/**
 * The FAQ page (B44-c): the landing page's questions plus the ones operators raise about
 * snapshots, upgrades, rollbacks and setup, grouped by task. Every answer is grounded in the
 * repository's own documentation (`doc/`, the README), and links the guide it comes from where
 * one exists. The same items feed the visible page and its FAQPage JSON-LD (META-2), so the
 * structured data cannot say anything the page does not.
 */

/** A guide in the repository's `doc/` directory, by file name. */
export type Guide =
  | 'building-running.md'
  | 'configuration.md'
  | 'docker.md'
  | 'manual-rollbacks.md'
  | 'migrations.md'
  | 'running.md'
  | 'state-snapshot.md'
  | 'troubleshooting.md'
  | 'upgrading-postgresql.md';

export interface FaqEntry extends FaqItem {
  /** The guide that covers the answer in full, where one exists. */
  readonly guide?: Guide;
}

export interface FaqSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly FaqEntry[];
}

type Translate = (message: PageMessage) => string;

/** Questions only the FAQ page carries; the landing page shows the first twelve. */
function extraItems(translate: Translate): Record<string, FaqItem> {
  return {
    docker: {
      key: 'docker',
      question: translate({id: 'faq.docker.q', message: 'Can I run it with Docker?'}),
      answer: translate({
        id: 'faq.docker.a',
        message:
          'Yes. The repository’s Docker Compose setup starts cardano-node, PostgreSQL and db-sync together with docker compose up -d. Set NETWORK to choose another network, such as preprod or preview.',
      }),
    },
    snapshots: {
      key: 'snapshots',
      question: translate({id: 'faq.snapshots.q', message: 'Where do I get a mainnet snapshot?'}),
      answer: translate({
        id: 'faq.snapshots.a',
        message:
          'Mainnet snapshots are published on the db-sync downloads page and linked from each release. Use the snapshot that matches the release you run.',
      }),
    },
    portability: {
      key: 'portability',
      question: translate({
        id: 'faq.portability.q',
        message: 'Can I restore a snapshot made by another version?',
      }),
      answer: translate({
        id: 'faq.portability.a',
        message:
          'No. Snapshots are not portable across schema versions, and possibly not across CPU architectures. Restore one made for the release you are running, on a node that is already ahead of the snapshot point.',
      }),
    },
    versions: {
      key: 'versions',
      question: translate({
        id: 'faq.versions.q',
        message: 'What do the four numbers in a release version mean?',
      }),
      answer: translate({
        id: 'faq.versions.a',
        message:
          'Releases are numbered a.b.c.d. A change to a needs a resync from genesis; b brings a schema migration; c changes values without changing the schema; d leaves the database unchanged.',
      }),
    },
    resync: {
      key: 'resync',
      question: translate({id: 'faq.resync.q', message: 'Does every upgrade mean a resync?'}),
      answer: translate({
        id: 'faq.resync.a',
        message:
          'No. Only a schema-breaking release needs a resync from genesis. Others run their migrations on start, and some replay the ledger rules, which can take hours but deletes no data.',
      }),
    },
    pgupgrade: {
      key: 'pgupgrade',
      question: translate({
        id: 'faq.pgupgrade.q',
        message: 'How do I move to a new PostgreSQL major version?',
      }),
      answer: translate({
        id: 'faq.pgupgrade.a',
        message:
          'A major PostgreSQL release usually changes its storage format, so the database has to be migrated with the new version installed alongside the old one. Allow about 350 GiB of free space.',
      }),
    },
    rollback: {
      key: 'rollback',
      question: translate({
        id: 'faq.rollback.q',
        message: 'How do I roll the database back to an earlier point?',
      }),
      answer: translate({
        id: 'faq.rollback.a',
        message:
          'Start db-sync with --rollback-to-slot, or stop it and use cardano-db-tool rollback. Both delete the blocks and their data from that slot forward; db-sync then syncs again from there.',
      }),
    },
    socket: {
      key: 'socket',
      question: translate({
        id: 'faq.socket.q',
        message: 'Why can it not connect to /var/run/postgresql/.s.PGSQL.5432 on macOS?',
      }),
      answer: translate({
        id: 'faq.socket.a',
        message:
          'PostgreSQL is not installed or not running. Install it, for example with Homebrew, start the service, and try again.',
      }),
    },
  };
}

/** The page's sections, in order. */
export function faqSections(translate: Translate): readonly FaqSection[] {
  const shared = Object.fromEntries(faqItems(translate).map((item) => [item.key, item]));
  const extra = extraItems(translate);
  const pick = (key: string, guide?: Guide): FaqEntry => {
    const found = shared[key] ?? extra[key];
    if (!found) throw new Error(`FAQ: no question with key ${key}`);
    return guide ? {...found, guide} : found;
  };
  return [
    {
      id: 'getting-started',
      title: translate({id: 'faq.section.start', message: 'Getting started'}),
      items: [
        pick('node', 'running.md'),
        pick('docker', 'docker.md'),
        pick('hardware'),
        pick('disk'),
        pick('compare'),
      ],
    },
    {
      id: 'syncing',
      title: translate({id: 'faq.section.sync', message: 'Syncing'}),
      items: [
        pick('sync', 'state-snapshot.md'),
        pick('genesis', 'state-snapshot.md'),
        pick('snapshots', 'state-snapshot.md'),
        pick('portability', 'state-snapshot.md'),
        pick('progress'),
        pick('read'),
        pick('share'),
      ],
    },
    {
      id: 'storage',
      title: translate({id: 'faq.section.storage', message: 'Storage and configuration'}),
      items: [pick('shrink', 'configuration.md'), pick('rollback', 'manual-rollbacks.md')],
    },
    {
      id: 'upgrades',
      title: translate({id: 'faq.section.upgrades', message: 'Upgrades'}),
      items: [
        pick('upgrade', 'migrations.md'),
        pick('versions', 'migrations.md'),
        pick('resync', 'migrations.md'),
        pick('postgres'),
        pick('pgupgrade', 'upgrading-postgresql.md'),
      ],
    },
    {
      id: 'troubleshooting',
      title: translate({id: 'faq.section.trouble', message: 'Troubleshooting'}),
      items: [pick('socket', 'troubleshooting.md')],
    },
  ];
}

/** Where a guide is read in full: the repository's `doc/` directory on its default branch. */
export function guideUrl(repoUrl: string, guide: Guide): string {
  return `${repoUrl.replace(/\/+$/, '')}/blob/master/doc/${guide}`;
}
