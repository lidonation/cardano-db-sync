#!/usr/bin/env node
/**
 * CON-4 gate — every config option the site can hand out is one db-sync reads, with a value it
 * accepts.
 *
 * The schema is `generated/config-schema.json`, extracted from the binary's own `FromJSON`
 * instances by `extract-config` (B10); its drift against the Haskell is caught by the extraction
 * workflow. This gate runs in the docs pipeline with no Haskell toolchain and fails the build when:
 *
 * - the committed schema is unsound (wrong version, unread parts, a source that does not exist);
 * - a shipped example config (`config/mainnet-config.yaml`, `config/preprod-config.yaml`) has a
 *   key db-sync does not read or a value it rejects;
 * - anything the config wizard emits (`src/data/config-wizard/*.json`) does — an invented option
 *   fails here, named, before a user can copy it.
 *
 * Run by `npm run check:config` and by CI.
 */
import {existsSync, readFileSync, readdirSync, realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import yaml from 'js-yaml';

import {findSchemaProblems, validateConfig} from '../src/data/config-schema.mjs';

/** Example configs shipped in the repository, repository-relative. */
export const EXAMPLE_CONFIGS = ['config/mainnet-config.yaml', 'config/preprod-config.yaml'];

/** What the wizard emits: config fragments merged into a full config file. */
export const WIZARD_DIR = 'src/data/config-wizard';

/**
 * Every reason the site could hand out a config db-sync would not read as written. An empty array
 * means the gate passes.
 *
 * @param {string} docsRoot the docs directory; the repository is its parent.
 */
export function findProblems(docsRoot) {
  const repoRoot = path.resolve(docsRoot, '..');
  const schemaPath = path.join(docsRoot, 'generated/config-schema.json');
  if (!existsSync(schemaPath)) {
    return ['generated/config-schema.json is missing — run the extract-haddock workflow'];
  }
  let schema;
  try {
    schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  } catch (error) {
    return [`generated/config-schema.json is not valid JSON: ${error.message}`];
  }

  const problems = findSchemaProblems(schema);
  if (problems.length > 0) return problems;
  for (const source of schema.sources) {
    const full = path.join(repoRoot, source);
    if (!existsSync(full) || !statSync(full).isFile()) {
      problems.push(`schema source ${source} does not exist as a file in the repository`);
    } else if (path.relative(realpathSync(repoRoot), realpathSync(full)).startsWith('..')) {
      problems.push(`schema source ${source} resolves outside the repository`);
    }
  }

  for (const file of EXAMPLE_CONFIGS) {
    const full = path.join(repoRoot, file);
    if (!existsSync(full)) {
      problems.push(`${file}: missing`);
      continue;
    }
    let config;
    try {
      config = yaml.load(readFileSync(full, 'utf8'));
    } catch (error) {
      problems.push(`${file}: not valid YAML: ${error.message}`);
      continue;
    }
    for (const problem of validateConfig(schema, config)) problems.push(`${file}: ${problem}`);
  }

  const wizardDir = path.join(docsRoot, WIZARD_DIR);
  const emitted = existsSync(wizardDir)
    ? readdirSync(wizardDir)
        .filter((name) => name.endsWith('.json'))
        .sort()
    : [];
  if (emitted.length === 0) {
    problems.push(`${WIZARD_DIR}: no wizard output to check — the gate would pass vacuously`);
  }
  for (const name of emitted) {
    const rel = `${WIZARD_DIR}/${name}`;
    let fragment;
    try {
      fragment = JSON.parse(readFileSync(path.join(wizardDir, name), 'utf8'));
    } catch (error) {
      problems.push(`${rel}: not valid JSON: ${error.message}`);
      continue;
    }
    for (const problem of validateConfig(schema, fragment, {fragment: true})) {
      problems.push(`${rel}: ${problem}`);
    }
  }
  return problems;
}

/**
 * Report on the tree under `root`, in the shape the CLI and the tests share.
 *
 * @returns {Promise<number>} the process exit code.
 */
export async function main(root, out) {
  const problems = findProblems(root);
  if (problems.length > 0) {
    out.error('check:config — the site would hand out config db-sync does not accept (CON-4):');
    for (const problem of problems) out.error(`  ${problem}`);
    out.error(
      'Fix the config, or regenerate generated/config-schema.json if the Haskell changed (docs/extractor).',
    );
    return 1;
  }
  const schema = JSON.parse(readFileSync(path.join(root, 'generated/config-schema.json'), 'utf8'));
  const wizard = readdirSync(path.join(root, WIZARD_DIR)).filter((n) => n.endsWith('.json'));
  out.log(
    `check:config — schema ${schema.schemaVersion} (${schema.root}), ${EXAMPLE_CONFIGS.length} example configs and ${wizard.length} wizard outputs accepted`,
  );
  return 0;
}

// Only run when invoked directly, so importing this module is side-effect free.
if (process.argv[1] === import.meta.filename) {
  const code = await main(path.resolve(import.meta.dirname, '..'), console);
  process.exit(code);
}
