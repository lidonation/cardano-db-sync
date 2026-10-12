import type {PageMessage} from '../i18n/pageTranslator';

/** One question; `key` is stable across locales, for anchors and the FAQ page's grouping. */
export interface FaqItem {
  readonly key: string;
  readonly question: string;
  readonly answer: string;
}

/**
 * The FAQ as the landing page shows it. Figures come from the repository README's system
 * requirements (May 2025) and `doc/`, not from the design file, whose drafts predate them. The
 * FAQ page (B44-c) adds the rest and the FAQPage structured data.
 */
export function faqItems(translate: (message: PageMessage) => string): readonly FaqItem[] {
  return [
    {
      key: 'sync',
      question: translate({
        id: 'landing.faq.sync.q',
        message: 'How long does the initial sync take?',
      }),
      answer: translate({
        id: 'landing.faq.sync.a',
        message:
          'Initial sync time depends on hardware, network and configuration. A compatible state snapshot lets you catch up from a recent point instead of starting at genesis.',
      }),
    },
    {
      key: 'disk',
      question: translate({id: 'landing.faq.disk.q', message: 'How much disk space do I need?'}),
      answer: translate({
        id: 'landing.faq.disk.a',
        message:
          '700 GB or more for mainnet with the default configuration, preferably on SSD. Configuration presets that leave out data you do not need make it much smaller.',
      }),
    },
    {
      key: 'genesis',
      question: translate({
        id: 'landing.faq.genesis.q',
        message: 'Can I skip syncing from genesis?',
      }),
      answer: translate({
        id: 'landing.faq.genesis.a',
        message:
          'Yes. Restore a state snapshot, which bundles the database and the ledger state; db-sync then follows the chain from that point.',
      }),
    },
    {
      key: 'shrink',
      question: translate({id: 'landing.faq.shrink.q', message: 'Can I shrink the database?'}),
      answer: translate({
        id: 'landing.faq.shrink.a',
        message:
          'Yes. Presets and insert options can reduce storage by leaving out data you do not need. The tx_out prune mode deletes spent outputs; consumed marks them without deleting them. Some choices cannot be undone without a resync.',
      }),
    },
    {
      key: 'node',
      question: translate({id: 'landing.faq.node.q', message: 'Do I need to run a cardano-node?'}),
      answer: translate({
        id: 'landing.faq.node.a',
        message: 'Yes. db-sync reads blocks from a local node through its socket.',
      }),
    },
    {
      key: 'hardware',
      question: translate({id: 'landing.faq.hardware.q', message: 'What hardware is recommended?'}),
      answer: translate({
        id: 'landing.faq.hardware.a',
        message:
          'For mainnet, with the node on the same machine: 64 GB of RAM or more, 4 CPU cores or more, and storage that sustains 60k IOPS or better.',
      }),
    },
    {
      key: 'postgres',
      question: translate({
        id: 'landing.faq.postgres.q',
        message: 'Which PostgreSQL versions work?',
      }),
      answer: translate({
        id: 'landing.faq.postgres.a',
        message:
          'The versions listed in each release’s notes. Check them before moving to a new PostgreSQL major version.',
      }),
    },
    {
      key: 'upgrade',
      question: translate({
        id: 'landing.faq.upgrade.q',
        message: 'How do I avoid a painful upgrade?',
      }),
      answer: translate({
        id: 'landing.faq.upgrade.a',
        message:
          'Read the release notes first and back up your database. db-sync runs pending migrations at startup. A release may require long migrations or a resync; the version number alone does not establish that.',
      }),
    },
    {
      key: 'progress',
      question: translate({id: 'landing.faq.progress.q', message: 'How do I check sync progress?'}),
      answer: translate({
        id: 'landing.faq.progress.a',
        message: 'Compare the time of the newest block with the current time, or watch the logs.',
      }),
    },
    {
      key: 'share',
      question: translate({
        id: 'landing.faq.share.q',
        message: 'Can two instances share one database?',
      }),
      answer: translate({
        id: 'landing.faq.share.a',
        message: 'No. Give each db-sync instance its own database.',
      }),
    },
    {
      key: 'read',
      question: translate({id: 'landing.faq.read.q', message: 'Can I query while it is syncing?'}),
      answer: translate({
        id: 'landing.faq.read.a',
        message:
          'Yes. The database is meant to be read by other applications while db-sync writes to it, though heavy queries slow the catch-up.',
      }),
    },
    {
      key: 'compare',
      question: translate({
        id: 'landing.faq.compare.q',
        message: 'How does this differ from Blockfrost or Kupo?',
      }),
      answer: translate({
        id: 'landing.faq.compare.a',
        message:
          'db-sync gives you chain data in PostgreSQL, with the data included controlled by your configuration. Blockfrost provides a hosted API and manages the infrastructure for you. Kupo indexes UTxOs matched by your rules with a smaller operating footprint.',
      }),
    },
  ];
}
