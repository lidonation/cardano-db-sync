import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
  annotationText,
  audit,
  digest,
  main,
  readHeadings,
} from '../../scripts/check-doc-parity.mjs';

type Target = {kind: string; file: string; heading?: string; name?: string; sha256: string};
type Entry = {sha256: string; targets?: string[]; omission?: string};
type Source = {preambleSha256: string; headings: Record<string, Entry>};
type Manifest = {
  schemaVersion: number;
  sources: Record<string, Source>;
  targets: Record<string, Target>;
};
let repo: string;
let docs: string;
let manifest: Manifest;
let artifact: {files: {path: string; annotations: {name: string; doc: string; line: number}[]}[]};
const guide = '# Install\n\nKeep this procedure.\n\n## Verify\n\nRun the smoke check.\n';
const reference = '# Reference\n\nThe reference details.\n';
const omission = '# Old navigation\n\nIndex.\n';
const reason = 'Superseded by site navigation.';
function write(file: string, text: string) {
  const target = path.join(repo, file);
  mkdirSync(path.dirname(target), {recursive: true});
  writeFileSync(target, text);
}
function json(file: string, value: unknown) {
  write(file, JSON.stringify(value));
}
function save() {
  json('docs/data/doc-parity.json', manifest);
  json('docs/generated/haddock-annotations.json', artifact);
}
function source(text: string, target: string | null): Source {
  const parsed = readHeadings(text);
  return {
    preambleSha256: parsed.preambleSha256,
    headings: Object.fromEntries(
      parsed.headings.map((h: {id: string; sha256: string}) => [
        h.id,
        {sha256: h.sha256, ...(target ? {targets: [target]} : {omission: reason})},
      ]),
    ),
  };
}
beforeEach(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'doc-parity-'));
  docs = path.join(repo, 'docs');
  write('doc/install.md', guide);
  write('doc/reference.md', reference);
  write('doc/Readme.md', omission);
  write('docs/docs/guides/install.md', '---\ntitle: Install\n---\n\n' + guide);
  write('src/Reference.hs', '-- | Reference details.\nreference = ()\n');
  json('docs/data/doc-triage.json', [
    {file: 'install.md', disposition: 'guide', reason: 'Procedure.'},
    {file: 'reference.md', disposition: 'annotation', reason: 'Reference.'},
    {file: 'Readme.md', disposition: 'omission', reason},
  ]);
  artifact = {
    files: [
      {
        path: 'src/Reference.hs',
        annotations: [{name: 'reference', doc: 'Reference details.', line: 2}],
      },
    ],
  };
  manifest = {
    schemaVersion: 1,
    sources: {
      'install.md': source(guide, 'install'),
      'reference.md': source(reference, 'reference'),
      'Readme.md': source(omission, null),
    },
    targets: {
      install: {
        kind: 'guide',
        file: 'docs/docs/guides/install.md',
        heading: 'h1 Install',
        sha256: readHeadings(guide).headings[0].subtreeSha256,
      },
      reference: {
        kind: 'annotation',
        file: 'src/Reference.hs',
        name: 'reference',
        sha256: digest(annotationText(artifact.files[0].annotations[0])),
      },
    },
  };
  save();
});
afterEach(() => rmSync(repo, {recursive: true, force: true}));

describe('CON-6 heading parity', () => {
  it('reports a deterministic green mapping including reasoned omissions', () => {
    const result = audit(docs);
    expect(result.problems).toEqual([]);
    expect(result.total).toBe(4);
    expect(result.accounted).toBe(4);
    const logs: string[] = [];
    expect(main(docs, {log: (text: string) => logs.push(text)})).toBe(0);
    expect(logs.join('\n')).toContain('4/4 headings accounted for (100%)');
    expect(logs.join('\n')).toContain(reason);
    const repeated: string[] = [];
    main(docs, {log: (text: string) => repeated.push(text)});
    expect(repeated).toEqual(logs);
  });

  it.each([
    ['deleted migrated section', '# Install\n\nKeep this procedure.\n'],
    ['deleted section body', '# Install\n\nKeep this procedure.\n\n## Verify\n'],
    ['replaced content with same headings', guide.replace('smoke check', 'unrelated action')],
  ])('fails a %s and names the affected legacy heading', (_case, changed) => {
    write('docs/docs/guides/install.md', changed);
    const result = audit(docs);
    expect(result.problems.join('\n')).toContain('doc/install.md');
    expect(result.problems.join('\n')).toContain('h2 Verify');
    expect(result.accounted).toBeLessThan(result.total);
    expect(main(docs, {log: () => {}})).toBe(1);
  });

  it.each([
    [guide + '\n## New heading\n\nNew information.\n', 'h2 New heading'],
    [guide.replace('Keep this procedure.', 'Changed upstream.'), 'h1 Install'],
    [guide.replace('## Verify\n\nRun the smoke check.\n', ''), 'h2 Verify'],
  ])('rejects upstream drift with a specific heading', (changed, heading) => {
    write('doc/install.md', changed);
    expect(audit(docs).problems.join('\n')).toContain(heading);
  });

  it('rejects a migrated guide hidden from production by draft frontmatter', () => {
    write('docs/docs/guides/install.md', '---\ntitle: Install\ndraft: true\n---\n\n' + guide);
    expect(audit(docs).problems.join('\n')).toContain('draft');
    expect(main(docs, {log: () => {}})).toBe(1);
  });

  it('names the pinned and current digests so a reviewed change can be re-pinned by hand', () => {
    const edited = 'Unreviewed preamble.\n\n' + guide.replace('Keep this', 'Changed');
    write('doc/install.md', edited);
    const changedGuide = '---\ntitle: Install\n---\n\n' + guide.replace('smoke', 'final');
    write('docs/docs/guides/install.md', changedGuide);
    artifact.files[0].annotations[0].doc = 'Replaced reference.';
    save();
    const problems = audit(docs).problems.join('\n');
    const parsed = readHeadings(edited);
    expect(problems).toContain(
      `pinned ${manifest.sources['install.md'].preambleSha256}, now ${parsed.preambleSha256}`,
    );
    expect(problems).toContain(
      `pinned ${manifest.sources['install.md'].headings['h1 Install'].sha256}, now ${parsed.headings[0].sha256}`,
    );
    expect(problems).toContain(
      `pinned ${manifest.targets.install.sha256}, now ${readHeadings(changedGuide, true).headings[0].subtreeSha256}`,
    );
    expect(problems).toContain(
      `pinned ${manifest.targets.reference.sha256}, now ${digest(annotationText(artifact.files[0].annotations[0]))}`,
    );
  });

  it('detects preamble edits, untriaged new files and missing legacy files', () => {
    write('doc/install.md', 'Unreviewed preamble.\n\n' + guide);
    write('doc/extra.md', '# Extra\n');
    rmSync(path.join(repo, 'doc/reference.md'));
    const problems = audit(docs).problems.join('\n');
    expect(problems).toContain('preamble');
    expect(problems).toContain('extra.md');
    expect(problems).toContain('reference.md');
    expect(problems).toContain('h1 Reference');
  });

  it('does not go green when the legacy tree is removed', () => {
    rmSync(path.join(repo, 'doc'), {recursive: true});
    expect(audit(docs).problems.length).toBeGreaterThan(0);
  });

  it('rejects an empty legacy tree and baseline instead of a vacuous 0/0 success', () => {
    rmSync(path.join(repo, 'doc'), {recursive: true});
    mkdirSync(path.join(repo, 'doc'));
    manifest.sources = {};
    manifest.targets = {};
    json('docs/data/doc-triage.json', []);
    save();
    expect(audit(docs).problems.join('\n')).toContain('empty');
    expect(main(docs, {log: () => {}})).toBe(1);
  });

  it('rejects a missing annotation or changed field documentation, but ignores line movement', () => {
    artifact.files[0].annotations[0].line = 100;
    save();
    expect(audit(docs).problems).toEqual([]);
    artifact.files[0].annotations[0].doc = 'Replaced reference.';
    save();
    expect(audit(docs).problems.join('\n')).toContain('doc/reference.md');
    artifact.files[0].annotations = [];
    save();
    expect(audit(docs).problems.join('\n')).toContain('reference');
    const before = {
      name: 'Record',
      doc: 'Table.',
      constructors: [{name: 'Record', doc: '', fields: [{name: 'field', doc: 'Meaning.'}]}],
    };
    expect(digest(annotationText(before))).not.toBe(
      digest(annotationText({...before, constructors: []})),
    );
  });

  it('enforces triage disposition, both destinations and omission reasons', () => {
    json('docs/data/doc-triage.json', [
      {file: 'install.md', disposition: 'both', reason: 'Split content.'},
      {file: 'reference.md', disposition: 'annotation', reason: 'Reference.'},
      {file: 'Readme.md', disposition: 'omission', reason},
    ]);
    manifest.sources['Readme.md'].headings['h1 Old navigation'].omission = 'Unreviewed change';
    save();
    const problems = audit(docs).problems.join('\n');
    expect(problems).toContain('both');
    expect(problems).toContain('B13');
  });

  it.each([
    null,
    [],
    {},
    {schemaVersion: 2},
    {schemaVersion: 1, sources: [], targets: {}},
    {schemaVersion: 1, sources: {'install.md': null}, targets: {}},
  ])('fails malformed manifests without throwing (%j)', (bad) => {
    json('docs/data/doc-parity.json', bad);
    expect(() => audit(docs)).not.toThrow();
    expect(main(docs, {log: () => {}})).toBe(1);
  });

  it('rejects empty mappings, unknown targets, unsafe target paths and unmapped headings', () => {
    manifest.sources['install.md'].headings['h1 Install'].targets = [];
    manifest.sources['install.md'].headings['h2 Verify'].targets = ['missing'];
    manifest.targets.reference.file = '../outside.hs';
    delete manifest.sources['Readme.md'].headings['h1 Old navigation'];
    save();
    const problems = audit(docs).problems.join('\n');
    expect(problems).toContain('non-empty');
    expect(problems).toContain('missing');
    expect(problems).toContain('repository');
    expect(problems).toContain('h1 Old navigation');
  });

  it('rejects legacy symlinks and targets that resolve outside the repository', () => {
    symlinkSync(path.join(repo, 'docs/docs/guides/install.md'), path.join(repo, 'doc/linked.md'));
    expect(audit(docs).problems.join('\n')).toContain('symlink');
    rmSync(path.join(repo, 'doc/linked.md'));
    const outside = mkdtempSync(path.join(os.tmpdir(), 'parity-outside-'));
    try {
      writeFileSync(path.join(outside, 'guide.md'), guide);
      rmSync(path.join(repo, 'docs/docs/guides/install.md'));
      symlinkSync(path.join(outside, 'guide.md'), path.join(repo, 'docs/docs/guides/install.md'));
      expect(audit(docs).problems.join('\n')).toContain('inside the repository');
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
  });

  it('keeps malformed nested values in a failed report', () => {
    json('docs/data/doc-parity.json', {
      ...manifest,
      sources: {
        ...manifest.sources,
        'Readme.md': {
          ...manifest.sources['Readme.md'],
          headings: {'h1 Old navigation': {sha256: digest(omission), omission: {toString: null}}},
        },
      },
    });
    const logs: string[] = [];
    expect(main(docs, {log: (line: string) => logs.push(line)})).toBe(1);
    expect(logs.join('\n')).toContain('accepted omission needs a reason');
  });

  it.each([
    {kind: 'unknown'},
    {sha256: 'not-a-digest'},
    {file: 'src/Reference.hs'},
    {heading: 'h2 Missing destination'},
  ])('rejects invalid or vanished target selectors (%j)', (change) => {
    Object.assign(manifest.targets.install, change);
    save();
    expect(audit(docs).problems.some((problem: string) => problem.includes('doc/install.md'))).toBe(
      true,
    );
    expect(main(docs, {log: () => {}})).toBe(1);
  });

  it('rejects stale target definitions and ambiguous/empty omission records', () => {
    manifest.targets.unused = {...manifest.targets.install};
    manifest.sources['Readme.md'].headings['h1 Old navigation'].targets = ['install'];
    manifest.sources['reference.md'].headings['h1 Reference'] = {
      sha256: digest(reference),
      omission: '',
    };
    save();
    const problems = audit(docs).problems.join('\n');
    expect(problems).toContain('Unused/stale target unused');
    expect(problems).toContain('exactly one');
    expect(problems).toContain('needs a reason');
  });

  it('fails malformed triage/artifact inputs and duplicate file dispositions', () => {
    json('docs/generated/haddock-annotations.json', null);
    expect(main(docs, {log: () => {}})).toBe(1);
    save();
    json('docs/data/doc-triage.json', {});
    expect(main(docs, {log: () => {}})).toBe(1);
    json('docs/data/doc-triage.json', [
      null,
      {file: 'install.md', disposition: 'unknown', reason: ''},
      {file: 'install.md', disposition: 'guide', reason: 'Procedure.'},
      {file: 'install.md', disposition: 'guide', reason: 'Duplicate.'},
    ]);
    const problems = audit(docs).problems.join('\n');
    expect(problems).toContain('valid disposition and reason');
    expect(problems).toContain('B13 duplicate file');
  });

  it('reports unreadable/invalid JSON as a failed check', () => {
    write('docs/data/doc-parity.json', '{invalid');
    expect(main(docs, {log: () => {}})).toBe(1);
    rmSync(path.join(docs, 'data/doc-parity.json'));
    expect(main(docs, {log: () => {}})).toBe(1);
  });
});

it('parses real Markdown headings, repeated headings and stable line endings', () => {
  const text =
    'Preamble\n\nTitle\n=====\n\n```sh\n# not a heading\n```\n\n## A `code` [link](url)\n\nBody.\n\n## A `code` [link](url)\n';
  const parsed = readHeadings(text);
  expect(parsed.headings.map((h: {id: string}) => h.id)).toEqual([
    'h1 Title',
    'h2 A code link',
    'h2 A code link [2]',
  ]);
  expect(readHeadings(text.replaceAll('\n', '\r\n'))).toEqual(parsed);
  expect(
    readHeadings('---\ntitle: Ignore me\n---\n\n# Real', true).headings.map(
      (h: {id: string}) => h.id,
    ),
  ).toEqual(['h1 Real']);
});

it('validates the real migration record without changing any inputs', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const inputs = [
    'data/doc-triage.json',
    'data/doc-parity.json',
    'generated/haddock-annotations.json',
    '../doc/installing.md',
    'docs/guides/installing.md',
  ];
  const before = inputs.map((file) => readFileSync(path.join(root, file), 'utf8'));
  expect(audit(root).problems).toEqual([]);
  expect(inputs.map((file) => readFileSync(path.join(root, file), 'utf8'))).toEqual(before);
});

it('audits the original git snapshot after explicit retirement, rejecting a mismatched tree', async () => {
  const {execFileSync} = await import('node:child_process');
  const git = (...args: string[]) =>
    execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim();
  git('init', '-q');
  git('add', 'doc');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'original source',
  );
  const sourceCommit = git('rev-parse', 'HEAD');
  const sourceTree = git('rev-parse', 'HEAD:doc');
  json('docs/data/doc-retirement.json', {sourceCommit, sourceTree});
  const before = audit(docs);
  rmSync(path.join(repo, 'doc'), {recursive: true});
  expect(audit(docs)).toEqual(before);
  write('docs/docs/guides/install.md', '# Install\n\n## Verify\n');
  expect(audit(docs).problems.join('\n')).toContain('migrated section changed');
  json('docs/data/doc-retirement.json', {sourceCommit, sourceTree: '0'.repeat(40)});
  expect(audit(docs).problems.join('\n')).toContain('source tree does not match');
  json('docs/data/doc-retirement.json', {sourceCommit: '../other', sourceTree});
  expect(audit(docs).problems.join('\n')).toContain('full source commit');
});
