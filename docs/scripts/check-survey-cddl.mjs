#!/usr/bin/env node
/** Optional independent conformance proof, not shipped in the browser. Requires Rust/Cargo. */
import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, URL} from 'node:url';
const fixture = fileURLToPath(new URL('../test/fixtures/survey/', import.meta.url));
const vectors = JSON.parse(readFileSync(path.join(fixture, 'vectors.json'), 'utf8'));
const temp = mkdtempSync(path.join(tmpdir(), 'survey-cddl-'));
try {
  const files = ['definitionHex', 'responseHex'].map((name) => {
    const file = path.join(temp, `${name}.cbor`);
    writeFileSync(file, Buffer.from(vectors[name], 'hex'));
    return file;
  });
  execFileSync(
    'cargo',
    [
      'run',
      '--release',
      '--locked',
      '--manifest-path',
      path.join(fixture, 'validator/Cargo.toml'),
      '--target-dir',
      path.join(tmpdir(), 'survey-cddl-target'),
      '--',
      path.join(fixture, 'cip179-v5.cddl'),
      ...files,
    ],
    {stdio: 'inherit', env: {...process.env, CARGO_BUILD_JOBS: '2'}},
  );
} finally {
  rmSync(temp, {recursive: true, force: true});
}
