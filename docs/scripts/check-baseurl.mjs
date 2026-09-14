#!/usr/bin/env node
/**
 * ENV-1 gate — no hardcoded environment value outside the profile module.
 *
 * Fails the build when a source, config or content file contains a developer/production URL
 * literal, or assigns `baseUrl` to a string literal, anywhere other than `config/profiles.ts`.
 * Run by `npm run check:baseurl` and by CI.
 */
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Directories never scanned. */
const SKIP_DIRS = new Set(['node_modules', 'build', '.docusaurus', 'coverage', '.git']);

/** Extensions worth scanning. Binary and lockfile noise is skipped. */
const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.html',
]);

/**
 * Files allowed to hold the literals, with the reason.
 * Paths are POSIX-relative to the docs root.
 */
const ALLOWLIST = new Map([
  ['config/profiles.ts', 'the single origin for every profile value (ENV-1)'],
  ['scripts/check-baseurl.mjs', 'this gate has to name what it looks for'],
  ['SPECIFICATION.md', 'normative planning document, not shipped source'],
  ['DESIGN.md', 'design reference, not shipped source'],
  ['package-lock.json', 'generated dependency lockfile'],
  ['eslint.config.mjs', 'the lint rule has to name the literal it forbids'],
]);

/**
 * A GitHub repository URL legitimately contains the repository name. Content links to
 * `github.com/<org>/cardano-db-sync/blob/...` constantly and none of those is a baseUrl, so the
 * repository URL is removed from a line before the rules see it.
 */
const GITHUB_REPO_URL = /https?:\/\/github\.com\/[\w.-]+\/cardano-db-sync/g;

/** Test files may assert the literal values; they are not part of the built site. */
const ALLOWED_PREFIXES = ['test/'];

const RULES = [
  {
    id: 'dev-baseurl',
    pattern: /\/cardano-db-sync\//,
    message: 'hardcoded developer baseUrl',
  },
  {
    id: 'prod-host',
    pattern: /dbsync\.cardano\.intersect\.org/,
    message: 'hardcoded production host',
  },
  {
    id: 'baseurl-literal',
    pattern: /\bbaseUrl\s*[:=]\s*['"`]/,
    message: 'baseUrl assigned a string literal',
  },
];

function isAllowed(relPath) {
  if (ALLOWLIST.has(relPath)) {
    return true;
  }
  return ALLOWED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

async function* walk(dir) {
  const entries = await readdir(dir, {withFileTypes: true});
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      yield* walk(full);
      continue;
    }
    if (entry.isFile()) {
      yield full;
    }
  }
}

export async function findViolations(root = ROOT) {
  const violations = [];

  for await (const full of walk(root)) {
    const relPath = path.relative(root, full).split(path.sep).join('/');

    if (!SCAN_EXTENSIONS.has(path.extname(full))) {
      continue;
    }
    if (isAllowed(relPath)) {
      continue;
    }

    const contents = await readFile(full, 'utf8');
    const lines = contents.split('\n');

    lines.forEach((line, index) => {
      const scannable = line.replace(GITHUB_REPO_URL, 'https://github.com/REPO');

      for (const rule of RULES) {
        if (rule.pattern.test(scannable)) {
          violations.push({
            file: relPath,
            line: index + 1,
            rule: rule.id,
            message: rule.message,
            text: line.trim(),
          });
        }
      }
    });
  }

  return violations;
}

/**
 * A reporter. Node's `console` satisfies it; tests pass a recorder.
 *
 * The parameter is annotated rather than left to inference from the `console` default: inference
 * picks up whichever `Console` type the lib set resolves to, which differed between this machine
 * and CI and produced a type error only in CI.
 *
 * @typedef {{log: (message: string) => void, error: (message: string) => void}} Reporter
 */

/**
 * Run the gate and report. Returns the process exit code: 0 clean, 1 on any violation.
 *
 * @param {string} [root] Directory to scan. Defaults to the docs root.
 * @param {Reporter} [out] Where the report goes.
 * @returns {Promise<number>}
 */
export async function main(root = ROOT, out = /** @type {Reporter} */ (console)) {
  const violations = await findViolations(root);

  if (violations.length === 0) {
    out.log('check:baseurl - clean. Every environment value comes from config/profiles.ts.');
    return 0;
  }

  out.error(`check:baseurl - ${violations.length} violation(s) of ENV-1:\n`);
  for (const v of violations) {
    out.error(`  ${v.file}:${v.line}  ${v.message}`);
    out.error(`    ${v.text}`);
  }
  out.error(
    '\nEnvironment values belong in config/profiles.ts and reach the rest of the site through ' +
      'resolveProfile() or siteConfig.customFields.profile.',
  );

  return 1;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
