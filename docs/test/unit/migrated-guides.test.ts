import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {describe, expect, it} from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const sourceNames = [
  'building-running',
  'database-encode-decode',
  'docker',
  'installing-with-nix',
  'installing',
  'interesting-queries',
  'manual-rollbacks',
  'migrations',
  'running',
  'schema-management',
  'state-snapshot',
  'troubleshooting',
  'upgrading-postgresql',
  'validation',
];
const newlyPublished = sourceNames;
function migratedPath(name: string): string {
  const paths = [
    path.join(root, 'docs/docs/guides', `${name}.md`),
    path.join(root, 'docs/migration/guides', `${name}.md`),
  ];
  const present = paths.filter((file) => existsSync(file));
  expect(present, `${name} must exist exactly once`).toHaveLength(1);
  return present[0];
}

it('publishes every migrated legacy procedure', () => {
  for (const name of newlyPublished) {
    expect(existsSync(path.join(root, 'docs/docs/guides', `${name}.md`)), name).toBe(true);
    expect(existsSync(path.join(root, 'docs/migration/guides', `${name}.md`)), name).toBe(false);
  }
});

const schema = JSON.parse(readFileSync(path.join(root, 'docs/generated/schema.json'), 'utf8')) as {
  tables: {name: string; columns: {name: string}[]}[];
};

// Parse headings instead of treating shell/SQL lines beginning with # as headings.
function headings(source: string): string[] {
  return unified()
    .use(remarkParse)
    .parse(source)
    .children.filter((node) => node.type === 'heading')
    .map((node) => source.slice(node.position!.start.offset, node.position!.end.offset).trim());
}

it('does not mistake a hash inside a code fence for a heading to preserve', () => {
  expect(headings('# Title\n\n```sql\n# with const as (...)\n```')).toEqual(['# Title']);
});

describe('legacy procedural migration (CON-8, GDE-1)', () => {
  it.each(sourceNames)('preserves the headings of %s and declares known dependencies', (name) => {
    const source = readFileSync(path.join(root, 'doc', `${name}.md`), 'utf8');
    const guide = readFileSync(migratedPath(name), 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(guide);
    expect(front).not.toBeNull();
    const {requires} = yaml.load(front![1]) as {
      requires: {tables: string[]; columns: string[]; config: string[]};
    };
    expect(Array.isArray(requires.tables)).toBe(true);
    expect(Array.isArray(requires.columns)).toBe(true);
    expect(Array.isArray(requires.config)).toBe(true);
    for (const table of requires.tables)
      expect(
        schema.tables.some((t) => t.name === table),
        table,
      ).toBe(true);
    for (const column of requires.columns) {
      const [table, field] = column.split('.');
      expect(
        schema.tables.some((t) => t.name === table && t.columns.some((c) => c.name === field)),
        column,
      ).toBe(true);
    }
    for (const heading of headings(source)) expect(guide).toContain(heading.trim());
  });
});

type ConfigNode = {name: string; shape?: {keys?: ConfigNode[]}};
const config = JSON.parse(
  readFileSync(path.join(root, 'docs/generated/config-schema.json'), 'utf8'),
) as {config: {keys: ConfigNode[]}};
function configKeys(nodes: ConfigNode[], prefix = ''): string[] {
  return nodes.flatMap((node) => {
    const name = prefix ? `${prefix}.${node.name}` : node.name;
    return [name, ...configKeys(node.shape?.keys ?? [], name)];
  });
}

it('every guide declares valid known entities without hand-authored version ranges', () => {
  const directory = path.join(root, 'docs/docs/guides');
  const knownKeys = configKeys(config.config.keys);
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.md'))) {
    const text = readFileSync(path.join(directory, name), 'utf8');
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(match, name).not.toBeNull();
    const front = yaml.load(match![1]) as {
      requires: {tables: string[]; columns: string[]; config: string[]};
      version_range?: unknown;
    };
    expect(front.version_range, name).toBeUndefined();
    expect(front.requires, name).toBeTruthy();
    for (const table of front.requires.tables)
      expect(
        schema.tables.some((entry) => entry.name === table),
        `${name}: ${table}`,
      ).toBe(true);
    for (const id of front.requires.columns) {
      const [table, column, extra] = id.split('.');
      expect(extra, `${name}: ${id}`).toBeUndefined();
      expect(
        schema.tables.some(
          (entry) => entry.name === table && entry.columns.some((field) => field.name === column),
        ),
        `${name}: ${id}`,
      ).toBe(true);
    }
    for (const id of front.requires.config) expect(knownKeys, `${name}: ${id}`).toContain(id);
  }
});

it('does not instruct operators to overwrite Nix configuration or publish example admin credentials', () => {
  const nix = readFileSync(migratedPath('installing-with-nix'), 'utf8');
  const docker = readFileSync(migratedPath('docker'), 'utf8');
  expect(nix).not.toContain('sudo tee /etc/nix/nix.conf');
  expect(docker).not.toContain('SMASH_PASSWORD=smash-password');
  expect(docker).toContain('127.0.0.1:3100:3100');
});

it('keeps node and db-sync example paths consistent and executable', () => {
  const guide = readFileSync(migratedPath('running'), 'utf8');
  expect(guide).toContain('--config ~/src/cardano-environments/mainnet/config.json \\\n');
  expect(guide).toContain('--topology ~/src/cardano-environments/mainnet/topology.json \\\n');
  expect(guide).toContain('--socket-path ~/src/cardano-environments/mainnet/node.socket');
  expect(guide).not.toContain('cardano-db-sync -- \\\n');
});

it('requires a reversible PostgreSQL upgrade rather than deleting the old cluster', () => {
  const guide = readFileSync(migratedPath('upgrading-postgresql'), 'utf8');
  expect(guide).not.toContain('sudo pkill -f');
  expect(guide).not.toContain('./delete-old-cluster.sh');
  expect(guide).not.toContain('sudo apt remove postgresql');
  expect(guide).toContain('/etc/postgresql/15/main/postgresql.conf');
  expect(guide).toMatch(/verified backup/i);
});

it('does not suggest creating a system-wide PostgreSQL socket symlink', () => {
  const guide = readFileSync(migratedPath('troubleshooting'), 'utf8');
  expect(guide).not.toContain('sudo ln -s /tmp/.s.PGSQL.5432');
  expect(guide).toContain('PGHOST=/tmp');
});

it('declares the schema entities used by the concrete Hasql examples', () => {
  const text = readFileSync(migratedPath('database-encode-decode'), 'utf8');
  const front = yaml.load(/^---\n([\s\S]*?)\n---/.exec(text)![1]) as {
    requires: {tables: string[]; columns: string[]};
  };
  expect(front.requires.tables).toEqual(
    expect.arrayContaining(['address', 'ma_tx_out', 'event_info']),
  );
  expect(front.requires.columns).toEqual(
    expect.arrayContaining([
      'tx_out.address_id',
      'ma_tx_out.quantity',
      'ma_tx_out.tx_out_id',
      'ma_tx_out.ident',
      'event_info.tx_id',
      'event_info.epoch',
      'event_info.type',
      'event_info.explanation',
    ]),
  );
});

it('records the Hasql example as address-variant specific', () => {
  const locks = JSON.parse(
    readFileSync(path.join(root, 'docs/generated/guide-locks.json'), 'utf8'),
  ) as {variants: Record<string, Record<string, string[]>>};
  expect(locks.variants['docs/guides/database-encode-decode.md'].current).toEqual(['address']);
});

it('locks the block columns used to select and verify rollback points', () => {
  const text = readFileSync(migratedPath('manual-rollbacks'), 'utf8');
  const front = yaml.load(/^---\n([\s\S]*?)\n---/.exec(text)![1]) as {
    requires: {columns: string[]};
  };
  expect(front.requires.columns).toEqual(
    expect.arrayContaining([
      'block.id',
      'block.slot_no',
      'block.block_no',
      'block.epoch_no',
      'block.time',
    ]),
  );
});

it('locks the displayed metadata fields in the example SQL guide', () => {
  const text = readFileSync(migratedPath('interesting-queries'), 'utf8');
  const front = yaml.load(/^---\n([\s\S]*?)\n---/.exec(text)![1]) as {
    requires: {columns: string[]};
  };
  expect(front.requires.columns).toEqual(
    expect.arrayContaining(['meta.id', 'meta.start_time', 'meta.network_name']),
  );
  expect(text).toMatch(/historical example.*additional columns/is);
});

it('uses the real numeric array type in the multi-asset DbInfo example', () => {
  const text = readFileSync(migratedPath('database-encode-decode'), 'utf8');
  expect(text).toContain('("quantity", "numeric[]")');
  expect(text).not.toContain('("quantity", "bigint[]")');
});

it('uses the project’s numeric DbWord64 codecs and database column order', () => {
  const text = readFileSync(migratedPath('database-encode-decode'), 'utf8');
  expect(text).toContain(
    'maTxOutAddressBulkEncoder :: E.Params ([DbWord64], [Id.TxOutAddressId], [Id.MultiAssetId])',
  );
  expect(text).toContain('bulkEncoder $ E.nonNullable dbWord64ValueEncoder');
  expect(text).toContain('maTxOutAddressQuantity >$< dbWord64Encoder');
  expect(text).not.toContain('fromIntegral . unDbWord64 >$< E.int8');
  expect(text).not.toContain('DbWord64 . fromIntegral <$> D.int8');
});
