import type {PageMessage} from '../i18n/pageTranslator';

export const messages = {
  title: {id: 'numbers.title', message: 'DB Sync by the Numbers'},
  preview: {id: 'numbers.preview', message: 'Preview'},
  mainnet: {id: 'numbers.mainnet', message: 'Mainnet'},
  intro: {
    id: 'numbers.intro',
    message:
      'Network facts from the committed provider snapshot. Storage and cost are separate model outputs, not instance measurements.',
  },
  cadencePreview: {id: 'numbers.cadencePreview', message: 'Preview epochs last one day.'},
  cadenceMainnet: {id: 'numbers.cadenceMainnet', message: 'Mainnet epochs last five days.'},
  missing: {
    id: 'numbers.missing',
    message: 'Numbers unavailable: no committed chain snapshot is available yet.',
  },
  invalid: {
    id: 'numbers.invalid',
    message: 'Numbers unavailable: the committed snapshot is invalid.',
  },
  network: {
    id: 'numbers.network',
    message: 'Numbers unavailable: the snapshot belongs to another network.',
  },
  stale: {
    id: 'numbers.stale',
    message: 'Stale snapshot: these figures are retained from the last committed update.',
  },
  updated: {id: 'numbers.updated', message: 'Updated (UTC)'},
  source: {id: 'numbers.source', message: 'Provider source'},
  block: {id: 'numbers.block', message: 'Block height'},
  epoch: {id: 'numbers.epoch', message: 'Epoch'},
  transactions: {id: 'numbers.transactions', message: 'Transactions'},
  blocks: {id: 'numbers.blocks', message: 'Blocks this epoch'},
  boundary: {id: 'numbers.boundary', message: 'Next epoch boundary (UTC)'},
  facts: {id: 'numbers.facts', message: 'Provider facts'},
  recent: {id: 'numbers.recent', message: 'Recent epochs'},
  recentCaption: {id: 'numbers.recentCaption', message: 'Recent provider epoch totals'},
  blocksColumn: {id: 'numbers.blocksColumn', message: 'Blocks'},
  transactionsColumn: {id: 'numbers.transactionsColumn', message: 'Transactions'},
  boundaryColumn: {id: 'numbers.boundaryColumn', message: 'Boundary (UTC)'},
  storage: {id: 'numbers.storage', message: 'Storage and cost'},
  modelled: {id: 'numbers.modelled', message: 'MODELLED ESTIMATES'},
  modelMissing: {
    id: 'numbers.modelMissing',
    message:
      'Modelled storage and cost estimates unavailable. No model outputs have been published yet.',
  },
  methodology: {id: 'numbers.methodology', message: 'Methodology'},
  configuration: {id: 'numbers.configuration', message: 'Configuration'},
  database: {id: 'numbers.database', message: 'Database size (GB)'},
  cost: {id: 'numbers.cost', message: 'Monthly cost (USD)'},
  tables: {id: 'numbers.tables', message: 'Modelled table sizes'},
  table: {id: 'numbers.table', message: 'Table'},
  size: {id: 'numbers.size', message: 'Size (GB)'},
  growth: {id: 'numbers.growth', message: 'Modelled growth per epoch'},
  growthSize: {id: 'numbers.growthSize', message: 'Modelled growth (GB)'},
  growthCaption: {id: 'numbers.growthCaption', message: 'Modelled growth per epoch'},
  growthSummary: {
    id: 'numbers.growthSummary',
    message:
      'Modelled growth across {count} epochs: epoch {firstEpoch} increased by {firstGB} GB; epoch {lastEpoch} increased by {lastGB} GB. The table lists every value.',
  },
  growthData: {id: 'numbers.growthData', message: 'View the growth data'},
  growthEmpty: {
    id: 'numbers.growthEmpty',
    message: 'Modelled growth unavailable: the snapshot has no per-epoch model outputs.',
  },
  tablesEmpty: {
    id: 'numbers.tablesEmpty',
    message: 'Modelled table sizes unavailable: the snapshot has no table model outputs.',
  },
  epochsEmpty: {
    id: 'numbers.epochsEmpty',
    message: 'Recent epochs unavailable: the provider snapshot has no completed epoch history.',
  },
} satisfies Record<string, PageMessage>;
