import {createHash} from 'node:crypto';
import {buildColumn, canonicalJson, compareNames} from './schema-model.mjs';

/** Preserve the real catalogue's resolved contracts for this variant. */
export function catalogToTables(catalog, variant) {
  return [...catalog.tables.entries()]
    .sort(([a], [b]) => compareNames(a, b))
    .map(([name, columns]) => ({
      name,
      variant,
      kind: columns[0]?.kind ?? 'table',
      columns: columns.map((column) => {
        const {kind: _kind, ...contract} = buildColumn(column, catalog.types);
        return contract;
      }),
    }));
}

/** Exact configuration paths, as extracted from Haskell FromJSON instances. */
export function configKeys(artifact) {
  const keys = [];
  function walk(nodes, prefix) {
    for (const node of nodes ?? []) {
      const name = prefix ? `${prefix}.${node.name}` : node.name;
      keys.push(name);
      walk(node.shape?.keys, name);
    }
  }
  walk(artifact.config?.keys, '');
  return keys;
}

/** Each release must produce an independently extracted schema and config. */
export function buildHistory(releases, extract) {
  if (!Array.isArray(releases) || !releases.length) throw new Error('release history is empty');
  const seen = new Set();
  const versions = releases.map((release) => {
    if (typeof release?.tag !== 'string' || seen.has(release.tag))
      throw new Error('invalid or duplicate release tag');
    seen.add(release.tag);
    const snapshot = extract(release);
    if (
      !snapshot ||
      snapshot.tag !== release.tag ||
      !Array.isArray(snapshot.schema?.tables) ||
      !Array.isArray(snapshot.config?.config?.keys)
    )
      throw new Error(`historical extraction failed for ${release.tag}`);
    return snapshot;
  });
  return {schemaVersion: 1, versions};
}

/** 13.7.2.0 retained an old epoch index after making epoch a view; replay its upgrade chronology. */
export function historyReplayPlan(files, tag) {
  const before = files.filter(
    (file) => file.stage < 4 && (tag !== '13.7.2.0' || file.stage !== 2 || file.version < 49),
  );
  const stage4 = files.filter((file) => file.stage === 4);
  const later = files.filter(
    (file) => tag === '13.7.2.0' && file.stage === 2 && file.version >= 49,
  );
  return [
    {files: before, variantAfter: true},
    {files: stage4, variantAfter: false},
    ...(later.length ? [{files: later, variantAfter: false}] : []),
  ];
}

const contractDigest = (value) =>
  `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;

/** Content-address shared snapshots so repeated patch releases do not duplicate megabytes. */
export function packHistory(history) {
  const schemas = Object.create(null);
  const configs = Object.create(null);
  const versions = history.versions.map(({tag, schema, config}) => {
    const schemaRef = contractDigest(schema);
    const configRef = contractDigest(config);
    schemas[schemaRef] = schema;
    configs[configRef] = config;
    return {tag, schemaRef, configRef};
  });
  return {schemaVersion: 2, versions, schemas, configs};
}

/** Resolve references only after checking every content digest and contract shape. */
export function unpackHistory(artifact) {
  if (
    artifact?.schemaVersion !== 2 ||
    !Array.isArray(artifact.versions) ||
    !artifact.schemas ||
    !artifact.configs
  )
    throw new Error('invalid guide history');
  for (const pool of [artifact.schemas, artifact.configs]) {
    for (const [digest, value] of Object.entries(pool))
      if (contractDigest(value) !== digest) throw new Error('guide history digest mismatch');
  }
  const seen = new Set();
  return artifact.versions.map(({tag, schemaRef, configRef}) => {
    const schema = artifact.schemas[schemaRef],
      config = artifact.configs[configRef];
    if (
      typeof tag !== 'string' ||
      seen.has(tag) ||
      !Array.isArray(schema?.tables) ||
      !Array.isArray(config?.config?.keys)
    )
      throw new Error('invalid guide history snapshot');
    if (config.unresolved?.length) throw new Error(`unresolved historical config in ${tag}`);
    seen.add(tag);
    return {tag, schema, config};
  });
}

/** Release metadata is passed to Git without a shell; do not accept options or revision syntax. */
export function validRelease(release) {
  return (
    typeof release?.tag === 'string' &&
    /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){3}$/.test(release.tag) &&
    typeof release.stage_two === 'string' &&
    /^\d{4}$/.test(release.stage_two) &&
    typeof release.stage_four === 'string' &&
    /^\d{4}$/.test(release.stage_four)
  );
}
