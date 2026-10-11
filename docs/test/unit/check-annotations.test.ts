import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {findProblems, main} from '../../scripts/check-annotations.mjs';
import type {AnnotatedModule} from '../../src/data/haddock';
import {findModule, loadAnnotations} from '../../src/data/haddock';

const DOCS_ROOT = path.resolve(import.meta.dirname, '../..');

/** One sound artifact entry; tests start from this and break it in one way. */
function fileEntry(overrides = {}): AnnotatedModule {
  return {
    path: 'cardano-db/src/Cardano/Db/Error.hs',
    module: 'Cardano.Db.Error',
    header: null,
    annotations: [
      {
        name: 'DbSessionError',
        kind: 'data',
        line: 42,
        doc: 'A session error.',
        position: 'before',
      },
    ],
    ...overrides,
  };
}

let repo: string;
let docs: string;

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-annotations-'));
  docs = path.join(repo, 'docs');
  await fs.mkdir(docs, {recursive: true});
});

afterEach(async () => {
  await fs.rm(repo, {recursive: true, force: true});
});

async function writeArtifact(artifact: unknown) {
  await fs.mkdir(path.join(docs, 'generated'), {recursive: true});
  await fs.writeFile(
    path.join(docs, 'generated/haddock-annotations.json'),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
}

/** Create the Haskell file an entry points at, so path existence checks pass. */
async function touchHaskellFile(relativePath: string) {
  await fs.mkdir(path.dirname(path.join(repo, relativePath)), {recursive: true});
  await fs.writeFile(path.join(repo, relativePath), '-- placeholder\n');
}

function recorderForShape() {
  return {log: () => {}, error: () => {}};
}

describe('check:annotations gate (CON-1)', () => {
  it.each([
    null,
    [],
    true,
    'artifact',
    {},
    {schemaVersion: 1, files: null},
    {schemaVersion: 1, files: [null]},
    {schemaVersion: {toString: null, valueOf: null}, files: []},
    {schemaVersion: 1, files: [{path: {toString: null, valueOf: null}}]},
    {
      schemaVersion: 1,
      files: [
        fileEntry({annotations: [{kind: {toString: null, valueOf: null}, line: {toString: null}}]}),
      ],
    },
    {schemaVersion: 1, files: [{path: 12}]},
    {schemaVersion: 1, files: [fileEntry({annotations: [null]})]},
    {schemaVersion: 1, files: [fileEntry({annotations: [{constructors: {}}]})]},
  ])('reports malformed JSON shapes without throwing: %j', async (artifact) => {
    await writeArtifact(artifact);
    expect(() => findProblems(docs)).not.toThrow();
    expect(findProblems(docs).length).toBeGreaterThan(0);
    expect(await main(docs, recorderForShape())).toBe(1);
  });

  it.each([undefined, 0, -1, 1.5])(
    'rejects missing or nonpositive section level %s',
    async (sectionLevel) => {
      const entry = fileEntry();
      await touchHaskellFile(entry.path);
      entry.annotations[0] = {
        name: '',
        kind: 'section',
        line: 1,
        doc: 'Heading',
        position: 'section',
        sectionLevel,
      };
      await writeArtifact({schemaVersion: 1, files: [entry]});
      expect(findProblems(docs).join('\n')).toContain('sectionLevel must be a positive integer');
    },
  );

  it('accepts a data type whose documentation lives on its fields', async () => {
    const entry = fileEntry();
    await touchHaskellFile(entry.path);
    entry.annotations[0].doc = '';
    entry.annotations[0].constructors = [
      {name: 'Error', doc: '', fields: [{name: 'code', doc: 'Error code.'}]},
    ];
    await writeArtifact({schemaVersion: 1, files: [entry]});
    expect(findProblems(docs)).toEqual([]);
  });

  it.each([
    null,
    {},
    [null],
    [{name: 'Error', doc: '', fields: null}],
    [{name: 'Error', doc: '', fields: [null]}],
  ])('rejects malformed constructor shape %j', async (constructors) => {
    const entry = fileEntry();
    await touchHaskellFile(entry.path);
    const annotation = entry.annotations[0] as unknown as Record<string, unknown>;
    annotation.constructors = constructors;
    await writeArtifact({schemaVersion: 1, files: [entry]});
    expect(() => findProblems(docs)).not.toThrow();
    expect(findProblems(docs).length).toBeGreaterThan(0);
  });

  it('passes over the real committed artifact', () => {
    expect(findProblems(DOCS_ROOT)).toEqual([]);
  });

  it('passes over a sound artifact whose files exist', async () => {
    const entry = fileEntry();
    await touchHaskellFile(entry.path);
    await writeArtifact({schemaVersion: 1, files: [entry]});
    expect(findProblems(docs)).toEqual([]);
  });

  it('fails on an unknown schema version', async () => {
    const entry = fileEntry();
    await touchHaskellFile(entry.path);
    await writeArtifact({schemaVersion: 2, files: [entry]});
    expect(findProblems(docs).join('\n')).toContain('schema version 2 is not 1');
  });

  it('fails when the artifact is missing', () => {
    expect(findProblems(docs).join('\n')).toContain('is missing');
  });

  it('fails on files that are not sorted by path', async () => {
    const first = fileEntry();
    const second = fileEntry({path: 'cardano-db/src/Cardano/Db/Error2.hs'});
    await touchHaskellFile(first.path);
    await writeArtifact({schemaVersion: 1, files: [second, first]});
    expect(findProblems(docs).join('\n')).toContain('files must be sorted by path');
  });

  it('fails on a path outside the repository or to a file that does not exist', async () => {
    await writeArtifact({schemaVersion: 1, files: [fileEntry({path: '../../etc/passwd.hs'})]});
    expect(findProblems(docs).join('\n')).toContain('path must be repository-relative');

    await writeArtifact({
      schemaVersion: 1,
      files: [fileEntry({path: 'cardano-db/src/Cardano/Db/Nope.hs'})],
    });
    expect(findProblems(docs).join('\n')).toContain('does not exist');
  });

  it('fails on an unknown annotation kind or position', async () => {
    const entry = fileEntry();
    await touchHaskellFile(entry.path);
    const mutable = entry.annotations[0] as unknown as Record<string, unknown>;
    mutable.kind = 'datatype';
    await writeArtifact({schemaVersion: 1, files: [entry]});
    expect(findProblems(docs).join('\n')).toContain('unknown kind');

    mutable.kind = 'data';
    mutable.position = 'above';
    await writeArtifact({schemaVersion: 1, files: [entry]});
    expect(findProblems(docs).join('\n')).toContain('unknown position');
  });

  it('fails on an annotation without a name or document', async () => {
    const nameless = fileEntry();
    await touchHaskellFile(nameless.path);
    nameless.annotations[0].name = '';
    await writeArtifact({schemaVersion: 1, files: [nameless]});
    expect(findProblems(docs).join('\n')).toContain('must carry a name');

    const docless = fileEntry();
    docless.annotations[0].doc = '';
    await writeArtifact({schemaVersion: 1, files: [docless]});
    expect(findProblems(docs).join('\n')).toContain('must carry a document');
  });

  it('fails on a non-section annotation carrying a section level', async () => {
    const entry = fileEntry();
    await touchHaskellFile(entry.path);
    entry.annotations[0].sectionLevel = 1;
    await writeArtifact({schemaVersion: 1, files: [entry]});
    expect(findProblems(docs).join('\n')).toContain('sectionLevel is only carried by section');
  });

  it('allows a section heading without a name but with a level', async () => {
    const entry = fileEntry();
    await touchHaskellFile(entry.path);
    entry.annotations[0] = {
      name: '',
      kind: 'section',
      line: 10,
      doc: 'Rendering',
      position: 'section',
      sectionLevel: 1,
    };
    await writeArtifact({schemaVersion: 1, files: [entry]});
    expect(findProblems(docs)).toEqual([]);
  });

  it('fails on a record field without a name', async () => {
    const entry = fileEntry();
    await touchHaskellFile(entry.path);
    entry.annotations[0].constructors = [
      {name: 'MkError', doc: 'c', fields: [{name: '', doc: 'f'}]},
    ];
    await writeArtifact({schemaVersion: 1, files: [entry]});
    expect(findProblems(docs).join('\n')).toContain('a record field must carry a name');
  });

  it('agrees with the access layer over the real artifact', () => {
    const artifact = loadAnnotations();
    for (const file of artifact.files) {
      expect(findProblems(DOCS_ROOT).join('\n')).not.toContain(file.path);
    }
    expect(findModule(artifact.files[0].path)?.annotations.length).toBeGreaterThanOrEqual(0);
  });
});

describe('check:annotations CLI reporting', () => {
  function recorder() {
    const lines: string[] = [];
    return {
      lines,
      log: (msg: string) => lines.push(msg),
      error: (msg: string) => lines.push(msg),
    };
  }

  it('exits 0 and reports the shape of the real artifact', async () => {
    const out = recorder();
    expect(await main(DOCS_ROOT, out)).toBe(0);
    expect(out.lines.join('\n')).toMatch(
      /check:annotations — schema 1, \d+ files, \d+ annotations/,
    );
  });

  it('exits 1 and names every problem', async () => {
    const entry = fileEntry();
    (entry.annotations[0] as unknown as Record<string, unknown>).kind = 'datatype';
    await writeArtifact({schemaVersion: 1, files: [entry]});
    const out = recorder();
    expect(await main(docs, out)).toBe(1);
    const report = out.lines.join('\n');
    expect(report).toContain('unknown kind');
    expect(report).toContain('Regenerate it with the extract-haddock workflow');
  });
});
