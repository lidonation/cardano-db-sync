#!/usr/bin/env node
/**
 * CON-1 gate — the committed Haddock annotations artifact is structurally sound.
 *
 * The artifact itself is produced by the `extract-haddock` workflow (B07); this gate runs in the
 * docs pipeline with no Haskell toolchain present, and fails the build when the committed JSON
 * cannot be consumed: wrong schema version, unsorted files, a module path that does not exist in
 * the repository, an unknown kind or position, or an annotation with a missing name or document.
 *
 * Regenerating the artifact is not this script's job — CI fails on drift in the extraction workflow
 * (CON-2).
 *
 * Run by `npm run check:annotations` and by CI.
 */
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Must match ANNOTATION_SCHEMA_VERSION in src/data/haddock.ts. */
const SCHEMA_VERSION = 1;

const KINDS = new Set([
  'data',
  'newtype',
  'type-synonym',
  'type-family',
  'data-family',
  'class',
  'function',
  'binding',
  'signature',
  'instance',
  'foreign',
  'class-method',
  'section',
  'named',
]);

const POSITIONS = new Set(['before', 'after', 'section', 'named']);

const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_']*(\.[A-Za-z_][A-Za-z0-9_']*)*$/;

/**
 * Every reason the committed artifact cannot be consumed, as readable lines.
 * An empty array means the artifact is sound.
 *
 * @param {string} docsRoot the docs directory (`artifactFile` lives at
 * `generated/` under it; the Haskell sources it references live one level up).
 */
export function findProblems(docsRoot) {
  const repoRoot = path.resolve(docsRoot, '..');
  const artifactPath = path.join(docsRoot, 'generated/haddock-annotations.json');
  if (!existsSync(artifactPath)) {
    return ['generated/haddock-annotations.json is missing — run the extract-haddock workflow'];
  }
  let raw;
  try {
    raw = readFileSync(artifactPath, 'utf8');
  } catch (error) {
    return [`generated/haddock-annotations.json could not be read: ${error.message}`];
  }
  let artifact;
  try {
    artifact = JSON.parse(raw);
  } catch (error) {
    return [`generated/haddock-annotations.json is not valid JSON: ${error.message}`];
  }

  const problems = [];

  if (artifact.schemaVersion !== SCHEMA_VERSION) {
    problems.push(`schema version ${artifact.schemaVersion} is not ${SCHEMA_VERSION}`);
  }

  if (!Array.isArray(artifact.files) || artifact.files.length === 0) {
    problems.push('files must be a non-empty array');
  }

  let previousPath = null;
  for (const file of artifact.files) {
    const at = file.path ?? '<missing path>';
    if (typeof file.path !== 'string' || !file.path.endsWith('.hs')) {
      problems.push(`${at}: path must be a .hs file`);
    }
    if (previousPath !== null && file.path <= previousPath) {
      problems.push(`${at}: files must be sorted by path (after ${previousPath})`);
    }
    previousPath = file.path;
    if (path.isAbsolute(file.path) || file.path.split('/').includes('..')) {
      problems.push(`${at}: path must be repository-relative`);
    }
    if (!existsSync(path.join(repoRoot, file.path))) {
      problems.push(`${at}: the referenced Haskell file does not exist`);
    }
    if (file.module !== null && !MODULE_NAME.test(file.module ?? '')) {
      problems.push(
        `${at}: module must be null or a dotted module name, got ${JSON.stringify(file.module)}`,
      );
    }
    if (file.header !== null && typeof file.header !== 'string') {
      problems.push(`${at}: header must be null or a string`);
    }
    if (file.cpp !== undefined && typeof file.cpp !== 'boolean') {
      problems.push(`${at}: cpp must be a boolean when present`);
    }
    if (!Array.isArray(file.annotations)) {
      problems.push(`${at}: annotations must be an array`);
      continue;
    }
    for (const annotation of file.annotations) {
      const atAnnotation = `${at}:${annotation.line ?? '?'}`;
      if (!KINDS.has(annotation.kind)) {
        problems.push(`${atAnnotation}: unknown kind ${JSON.stringify(annotation.kind)}`);
      }
      if (!POSITIONS.has(annotation.position)) {
        problems.push(`${atAnnotation}: unknown position ${JSON.stringify(annotation.position)}`);
      }
      if (
        annotation.kind !== 'section' &&
        (typeof annotation.name !== 'string' || annotation.name === '')
      ) {
        problems.push(`${atAnnotation}: a ${annotation.kind} annotation must carry a name`);
      }
      if (typeof annotation.doc !== 'string' || annotation.doc === '') {
        problems.push(`${atAnnotation}: annotation must carry a document`);
      }
      if (!Number.isInteger(annotation.line) || annotation.line < 1) {
        problems.push(`${atAnnotation}: line must be a positive integer`);
      }
      if (annotation.sectionLevel !== undefined && annotation.kind !== 'section') {
        problems.push(`${atAnnotation}: sectionLevel is only carried by section headings`);
      }
      if (annotation.kind === 'section' && !Number.isInteger(annotation.sectionLevel ?? 0)) {
        problems.push(
          `${atAnnotation}: sectionLevel must be a positive integer on section headings`,
        );
      }
      for (const constructor of annotation.constructors ?? []) {
        if (typeof constructor.name !== 'string' || constructor.name === '') {
          problems.push(`${atAnnotation}: a constructor must carry a name`);
        }
        if (typeof constructor.doc !== 'string') {
          problems.push(`${atAnnotation} ${constructor.name}: constructor doc must be a string`);
        }
        for (const field of constructor.fields ?? []) {
          if (typeof field.name !== 'string' || field.name === '') {
            problems.push(`${atAnnotation} ${constructor.name}: a record field must carry a name`);
          }
          if (typeof field.doc !== 'string') {
            problems.push(
              `${atAnnotation} ${constructor.name}.${field.name}: field doc must be a string`,
            );
          }
        }
      }
    }
  }

  return problems;
}

/**
 * Report on the artifact under `root`, in the shape the CLI and the tests share.
 *
 * @returns {Promise<number>} the process exit code.
 */
export async function main(root, out) {
  const problems = findProblems(root);
  if (problems.length > 0) {
    out.error('check:annotations — the committed artifact is not consumable:');
    for (const problem of problems) {
      out.error(`  ${problem}`);
    }
    out.error(
      'Regenerate it with the extract-haddock workflow (docs/extractor) and commit the result.',
    );
    return 1;
  }
  const artifact = JSON.parse(
    readFileSync(path.join(root, 'generated/haddock-annotations.json'), 'utf8'),
  );
  const files = artifact.files.length;
  const annotations = artifact.files.reduce((total, file) => total + file.annotations.length, 0);
  out.log(
    `check:annotations — schema ${artifact.schemaVersion}, ${files} files, ${annotations} annotations`,
  );
  return 0;
}

// Only run when invoked directly, so importing this module is side-effect free.
if (process.argv[1] === import.meta.filename) {
  const code = await main(path.resolve(import.meta.dirname, '..'), console);
  process.exit(code);
}
