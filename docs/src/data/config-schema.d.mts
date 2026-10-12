/** Types for `config-schema.mjs`; the shape mirrors `ConfigExtract.schemaJson`. */

export type ConfigShape =
  | {type: 'boolean'; nullable?: true}
  | {type: 'integer'; haskell?: string; minimum?: string; maximum?: string; nullable?: true}
  | {type: 'string'; nullable?: true}
  | {type: 'enum'; values: string[]; nullable?: true}
  | {type: 'array'; items: ConfigShape; minItems?: number; nullable?: true}
  | {type: 'opaque'; haskell: string; nullable?: true}
  | ConfigObjectShape;

export interface ConfigObjectShape {
  type: 'object';
  /** The Haskell type the object parses as. */
  haskell: string;
  /** Line of its `FromJSON` instance in `Cardano/DbSync/Config/Types.hs`. */
  line: number;
  keys: ConfigKey[];
  presets?: ConfigPreset[];
  nullable?: true;
}

export interface ConfigKey {
  name: string;
  required: boolean;
  shape: ConfigShape;
  /** What the binary uses when the key is absent (including object defaults). */
  default?: unknown;
}

/** A key that switches the defaults of its siblings, per accepted value. */
export interface ConfigPreset {
  key: string;
  values: Record<string, Record<string, unknown>>;
}

/** Top-level keys handed whole to another reader (trace-dispatcher). */
export interface ConfigPassthrough {
  keys: string[];
  reader: string;
}

export interface ConfigSchema {
  schemaVersion: number;
  sources: string[];
  root: string;
  config: ConfigObjectShape;
  passthrough: ConfigPassthrough[];
  unresolved: string[];
}

export interface ConfigOption {
  path: string;
  required: boolean;
  shape: ConfigShape;
  default?: unknown;
}

export const CONFIG_SCHEMA_VERSION: number;

export function validateConfig(
  schema: ConfigSchema,
  config: unknown,
  options?: {fragment?: boolean},
): string[];

export function listOptions(schema: ConfigSchema): ConfigOption[];

export function presetValues(
  schema: ConfigSchema,
  presetPath: string,
  value: string,
): Record<string, unknown> | undefined;

export function findSchemaProblems(schema: unknown): string[];
