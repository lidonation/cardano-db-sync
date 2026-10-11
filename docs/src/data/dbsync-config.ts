/**
 * The db-sync config schema the site uses — what the binary parses, extracted by B10 from the
 * `FromJSON` instances in `Cardano.DbSync.Config.Types` (CON-4).
 *
 * The artifact is produced by `docs/extractor` (`extract-config`, driven by the
 * `extract-haddock` workflow) and committed under `generated/`; `npm run build` reads only that
 * JSON, never Haskell. Regenerate after touching the config types:
 *
 *     cd docs/extractor && cabal run extract-config -- \
 *       --repo-root ../.. --out ../generated/config-schema.json
 *
 * The config wizard builds its options from `configOptions()` and checks what it emits with
 * `validateWizardOutput()`: the same validator `check:config` runs in CI.
 */
import artifact from '../../generated/config-schema.json';
import type {ConfigOption, ConfigSchema} from './config-schema.mjs';
import {
  CONFIG_SCHEMA_VERSION,
  listOptions,
  presetValues,
  validateConfig,
} from './config-schema.mjs';

export type {ConfigKey, ConfigOption, ConfigSchema, ConfigShape} from './config-schema.mjs';

/** The committed schema, refused if its version is not the one this code understands. */
export function loadConfigSchema(source: unknown = artifact): ConfigSchema {
  const schema = source as ConfigSchema;
  if (schema.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `config schema version ${schema.schemaVersion} is not ${CONFIG_SCHEMA_VERSION}; regenerate it`,
    );
  }
  return schema;
}

/** Every option db-sync reads, as dotted paths in source order. */
export function configOptions(schema: ConfigSchema = loadConfigSchema()): ConfigOption[] {
  return listOptions(schema);
}

/** Problems with a fragment the wizard is about to hand out; empty when db-sync accepts it. */
export function validateWizardOutput(
  fragment: unknown,
  schema: ConfigSchema = loadConfigSchema(),
): string[] {
  return validateConfig(schema, fragment, {fragment: true});
}

/** The `insert_options` values a preset sets when nothing overrides them. */
export function insertPreset(
  preset: string,
  schema: ConfigSchema = loadConfigSchema(),
): Record<string, unknown> | undefined {
  return presetValues(schema, 'insert_options.preset', preset);
}
