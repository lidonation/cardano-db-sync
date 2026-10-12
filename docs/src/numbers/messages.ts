import {translate} from '@docusaurus/Translate';
import type {PageMessage} from '../i18n/pageTranslator';

/** One definition per message. Injectable translation keeps full-page English fallback and
 * Docusaurus' literal translate-call extraction on the same catalog. */
export function numbersMessages<T>(translate: (message: PageMessage) => T) {
  return {
    title: translate({id: 'numbers.title', message: 'DB Sync by the Numbers'}),
    preview: translate({id: 'numbers.preview', message: 'Preview'}),
    mainnet: translate({id: 'numbers.mainnet', message: 'Mainnet'}),
    intro: translate({
      id: 'numbers.intro',
      message:
        'Network facts from the committed provider snapshot. Storage and cost are separate model outputs, not instance measurements.',
    }),
    cadencePreview: translate({
      id: 'numbers.cadencePreview',
      message: 'Preview epochs last one day.',
    }),
    cadenceMainnet: translate({
      id: 'numbers.cadenceMainnet',
      message: 'Mainnet epochs last five days.',
    }),
    missing: translate({
      id: 'numbers.missing',
      message: 'Numbers unavailable: no committed chain snapshot is available yet.',
    }),
    invalid: translate({
      id: 'numbers.invalid',
      message: 'Numbers unavailable: the committed snapshot is invalid.',
    }),
    network: translate({
      id: 'numbers.network',
      message: 'Numbers unavailable: the snapshot belongs to another network.',
    }),
    stale: translate({
      id: 'numbers.stale',
      message: 'Stale snapshot: these figures are retained from the last committed update.',
    }),
    updated: translate({id: 'numbers.updated', message: 'Updated (UTC)'}),
    source: translate({id: 'numbers.source', message: 'Provider source'}),
    block: translate({id: 'numbers.block', message: 'Block height'}),
    epoch: translate({id: 'numbers.epoch', message: 'Epoch'}),
    transactions: translate({id: 'numbers.transactions', message: 'Transactions'}),
    blocks: translate({id: 'numbers.blocks', message: 'Blocks this epoch'}),
    boundary: translate({id: 'numbers.boundary', message: 'Next epoch boundary (UTC)'}),
    facts: translate({id: 'numbers.facts', message: 'Provider facts'}),
    recent: translate({id: 'numbers.recent', message: 'Recent epochs'}),
    recentCaption: translate({
      id: 'numbers.recentCaption',
      message: 'Recent provider epoch totals',
    }),
    blocksColumn: translate({id: 'numbers.blocksColumn', message: 'Blocks'}),
    transactionsColumn: translate({id: 'numbers.transactionsColumn', message: 'Transactions'}),
    boundaryColumn: translate({id: 'numbers.boundaryColumn', message: 'Boundary (UTC)'}),
    storage: translate({id: 'numbers.storage', message: 'Storage and cost'}),
    modelled: translate({id: 'numbers.modelled', message: 'MODELLED ESTIMATES'}),
    modelMissing: translate({
      id: 'numbers.modelMissing',
      message:
        'Modelled storage and cost estimates unavailable. No model outputs have been published yet.',
    }),
    methodology: translate({id: 'numbers.methodology', message: 'Methodology'}),
    configuration: translate({id: 'numbers.configuration', message: 'Configuration'}),
    database: translate({id: 'numbers.database', message: 'Database size (GB)'}),
    cost: translate({id: 'numbers.cost', message: 'Monthly cost (USD)'}),
    tables: translate({id: 'numbers.tables', message: 'Modelled table sizes'}),
    table: translate({id: 'numbers.table', message: 'Table'}),
    size: translate({id: 'numbers.size', message: 'Size (GB)'}),
    growth: translate({id: 'numbers.growth', message: 'Modelled growth per epoch'}),
    growthSize: translate({id: 'numbers.growthSize', message: 'Modelled growth (GB)'}),
    growthCaption: translate({id: 'numbers.growthCaption', message: 'Modelled growth per epoch'}),
    growthSummary: translate({
      id: 'numbers.growthSummary',
      message:
        'Modelled growth across {count} epochs: epoch {firstEpoch} increased by {firstGB} GB; epoch {lastEpoch} increased by {lastGB} GB. The table lists every value.',
    }),
    growthData: translate({id: 'numbers.growthData', message: 'View the growth data'}),
    growthEmpty: translate({
      id: 'numbers.growthEmpty',
      message: 'Modelled growth unavailable: the snapshot has no per-epoch model outputs.',
    }),
    tablesEmpty: translate({
      id: 'numbers.tablesEmpty',
      message: 'Modelled table sizes unavailable: the snapshot has no table model outputs.',
    }),
    epochsEmpty: translate({
      id: 'numbers.epochsEmpty',
      message: 'Recent epochs unavailable: the provider snapshot has no completed epoch history.',
    }),
  };
}

export const messages = numbersMessages((message) => message);
export const localizedNumbersMessages = () => numbersMessages(translate);
