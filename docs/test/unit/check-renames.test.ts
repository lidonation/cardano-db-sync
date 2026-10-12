import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {findProblems, main} from '../../scripts/check-renames.mjs';
import {runAsScript} from './run-as-script';

const DOCS_ROOT = path.resolve(import.meta.dirname, '../..');
const FILE_A = 'migration-2-0026-20231017.sql';
const FILE_B = 'migration-2-0034-20240301.sql';

const at = (file: string) => ({
  stage: Number(file.split('-')[1]),
  version: Number(file.split('-')[2]),
  file,
});

/** A sound artifact: one table rename and one column rename. Tests break it in one way. */
function sound() {
  return {
    schemaVersion: 1,
    source: 'schema',
    renames: [
      {kind: 'table', from: 'old_t', to: 'new_t', migration: at(FILE_A), line: 9},
      {
        kind: 'column',
        table: 'pots',
        from: 'dep',
        to: 'dep_stake',
        migration: at(FILE_B),
        line: 15,
      },
    ],
    entities: [
      {
        kind: 'column',
        table: 'pots',
        name: 'dep_stake',
        formerNames: [{name: 'dep', until: at(FILE_B)}],
      },
      {kind: 'table', name: 'new_t', formerNames: [{name: 'old_t', until: at(FILE_A)}]},
    ],
  };
}

let repo: string;
let docs: string;

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-renames-'));
  docs = path.join(repo, 'docs');
  await fs.mkdir(path.join(docs, 'generated'), {recursive: true});
  await fs.mkdir(path.join(repo, 'schema'), {recursive: true});
  for (const file of [FILE_A, FILE_B]) {
    await fs.writeFile(path.join(repo, 'schema', file), '-- migration\n');
  }
});

afterEach(async () => {
  await fs.rm(repo, {recursive: true, force: true});
});

async function write(artifact: unknown) {
  const body = typeof artifact === 'string' ? artifact : `${JSON.stringify(artifact, null, 2)}\n`;
  await fs.writeFile(path.join(docs, 'generated/schema-renames.json'), body);
}

async function problemsOf(edit: (artifact: ReturnType<typeof sound>) => unknown) {
  const artifact = sound();
  await write(edit(artifact) ?? artifact);
  return findProblems(docs);
}

const quiet = () => ({log: () => {}, error: () => {}});

describe('check:renames', () => {
  it('passes the committed artifact', () => {
    expect(findProblems(DOCS_ROOT)).toEqual([]);
  });

  it('passes a sound artifact', async () => {
    expect(await problemsOf(() => undefined)).toEqual([]);
  });

  it('fails when the artifact is missing, unreadable JSON or not an object', async () => {
    expect(findProblems(docs)).toEqual([expect.stringMatching(/is missing/)]);
    await write('{');
    expect(findProblems(docs)).toEqual([expect.stringMatching(/not valid JSON/)]);
    await write('[]');
    expect(findProblems(docs)).toEqual(['artifact must be an object']);
  });

  it('fails on the wrong schema version, source or top-level shape', async () => {
    expect(
      await problemsOf((a) => ({...a, schemaVersion: 2, source: 'sql', renames: null})),
    ).toEqual([
      'schema version 2 is not 1',
      'source must be "schema", got "sql"',
      'renames and entities must be arrays',
    ]);
  });

  it('fails on a malformed rename', async () => {
    const problems = await problemsOf((a) => {
      a.renames.push(null as never);
      a.renames[0] = {...a.renames[0], kind: 'trigger', from: '', to: '', line: 0};
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'renames[0]: unknown kind "trigger"',
        'renames[0]: from must be a non-empty string',
        'renames[0]: to must be a non-empty string',
        'renames[0]: line must be a positive integer',
        'renames[0]: renames  to itself',
        'renames[2]: must be an object',
      ]),
    );
  });

  it('requires a table on columns and constraints, and only on them', async () => {
    expect(
      await problemsOf((a) => {
        delete (a.renames[1] as {table?: string}).table;
        (a.renames[0] as {table?: string}).table = 'x';
      }),
    ).toEqual(
      expect.arrayContaining([
        'renames[0]: only columns and constraints carry a table',
        'renames[1]: a column must name its table',
      ]),
    );
  });

  it('fails on a migration that is malformed, disagrees with its name or does not exist', async () => {
    const problems = await problemsOf((a) => {
      a.renames[0].migration = 'x' as never;
      a.renames[1].migration = {...at(FILE_B), version: 35};
      a.entities[0].formerNames[0].until = at('migration-2-0099-20990101.sql');
      a.entities[1].formerNames[0].until = {...at(FILE_A), file: 'notes.sql'};
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'renames[0]: migration must be an object',
        `renames[1]: stage/version 2/35 disagree with ${FILE_B}`,
        'entities[0].formerNames[0]: schema/migration-2-0099-20990101.sql does not exist',
        'entities[1].formerNames[0]: "notes.sql" is not a migration file name',
      ]),
    );
    expect(await problemsOf((a) => void (a.renames[0].migration = {} as never))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^renames\[0\]: .* is not a migration file name/),
      ]),
    );
  });

  it('rejects coercible migration filenames and unsupported stages without crashing', async () => {
    expect(
      await problemsOf((a) => {
        a.renames[0].migration.file = [FILE_A] as never;
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/not a migration file name/)]));
    await fs.writeFile(path.join(repo, 'schema', 'migration-5-0001-20200101.sql'), '');
    expect(
      await problemsOf((a) => {
        a.renames[0].migration = at('migration-5-0001-20200101.sql');
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/unsupported migration stage/)]));
  });

  it('fails on renames out of application order', async () => {
    expect(await problemsOf((a) => void a.renames.reverse())).toEqual([
      'renames[1]: renames must be in application order (stage, version, line)',
    ]);
    expect(
      await problemsOf((a) => {
        a.renames[1] = {...a.renames[1], migration: at(FILE_A), line: 9};
      }),
    ).toEqual(expect.not.arrayContaining([expect.stringMatching(/application order/)]));
  });

  it('fails when entities and renames disagree', async () => {
    const problems = await problemsOf((a) => {
      a.entities[0].formerNames[0].name = 'deposits';
      a.entities[1].formerNames = [];
      a.entities.push(
        null as never,
        {kind: 'table', name: 'x', formerNames: [{name: ''}]} as never,
      );
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        `entities[0].formerNames[0]: no rename of column deposits in ${FILE_B}`,
        'entities[1]: formerNames must be a non-empty array',
        'entities[2]: must be an object',
        'entities[3].formerNames[0]: must carry a name',
        `rename of column dep in ${FILE_B} belongs to no entity`,
        `rename of table old_t in ${FILE_A} belongs to no entity`,
      ]),
    );
  });

  it('keeps equal column names in different tables as separate histories', async () => {
    expect(
      await problemsOf((a) => {
        a.renames.push({...a.renames[1], table: 'other'});
        a.entities.push({...a.entities[0], table: 'other'});
      }),
    ).toEqual([]);
  });

  it('checks chain order and follows renamed owners', async () => {
    expect(
      await problemsOf((a) => {
        a.renames[1].table = 'new_t';
        a.entities[0].table = 'new_t';
      }),
    ).toEqual([]);
    expect(
      await problemsOf((a) => {
        a.renames[1] = {
          ...a.renames[0],
          from: 'new_t',
          to: 'latest',
          migration: at(FILE_B),
          line: 15,
        };
        a.entities = [
          {
            kind: 'table',
            name: 'latest',
            formerNames: [
              {name: 'new_t', until: at(FILE_B)},
              {name: 'old_t', until: at(FILE_A)},
            ],
          },
        ] as never;
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/history/)]));
  });

  it('rejects aliases reused by different renamed entities', async () => {
    expect(
      await problemsOf((a) => {
        a.renames[1] = {...a.renames[0], to: 'other', migration: at(FILE_B), line: 15};
        a.entities = [
          a.entities[1],
          {kind: 'table', name: 'other', formerNames: [{name: 'old_t', until: at(FILE_B)}]},
        ] as never;
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/ambiguous table name old_t/)]));
  });

  it('rejects incorrect final names, owners and duplicated rename statements', async () => {
    expect(await problemsOf((a) => void (a.entities[1].name = 'wrong'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/history/)]),
    );
    expect(await problemsOf((a) => void (a.entities[0].table = 'wrong'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/history/)]),
    );
    expect(await problemsOf((a) => void a.renames.splice(1, 0, {...a.renames[0]}))).toEqual(
      expect.arrayContaining([expect.stringMatching(/duplicate rename/)]),
    );
  });

  it('rejects malformed optional table fields', async () => {
    expect(await problemsOf((a) => ({...a, renames: [{...a.renames[0], table: 42}]}))).toEqual(
      expect.arrayContaining([expect.stringMatching(/only columns/)]),
    );
  });

  it('reports through main and exits non-zero on a broken artifact', async () => {
    const lines: string[] = [];
    const out = {log: (l: string) => lines.push(l), error: (l: string) => lines.push(l)};
    expect(main(DOCS_ROOT, out)).toBe(0);
    expect(lines.at(-1)).toMatch(/13 renames, 13 renamed entities/);
    expect(main(docs, quiet())).toBe(1);
  });

  it('runs as a script', async () => {
    expect(await runAsScript('../../scripts/check-renames.mjs', [])).toBe(0);
  });
});
