import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {QUICKSTART_COMMANDS} from '../../src/data/quickstart';

describe('quickstart commands', () => {
  it('contains no shell redirection placeholders and every command parses', () => {
    for (const command of Object.values(QUICKSTART_COMMANDS)) {
      expect(command).not.toMatch(/<[^>]+>/);
      expect(() => execFileSync('bash', ['-n', '-c', command])).not.toThrow();
    }
  });

  it.each(['operator', '*'])('queries the same connection as db-sync for user %s', (user) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickstart-'));
    try {
      fs.mkdirSync(path.join(dir, 'config'));
      fs.mkdirSync(path.join(dir, 'bin'));
      fs.writeFileSync(
        path.join(dir, 'config/pgpass-mainnet'),
        `db.example:5441:custom_db:${user}:unused`,
      );
      fs.writeFileSync(
        path.join(dir, 'bin/psql'),
        '#!/bin/sh\nprintf "%s|%s|%s|%s" "$PGHOST" "$PGPORT" "$PGDATABASE" "$PGUSER"',
        {mode: 0o755},
      );
      const result = execFileSync('bash', ['-c', QUICKSTART_COMMANDS.query], {
        cwd: dir,
        env: {...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`},
        encoding: 'utf8',
      });
      const expectedUser =
        user === '*' ? execFileSync('id', ['-un'], {encoding: 'utf8'}).trim() : user;
      expect(result).toBe(`db.example|5441|custom_db|${expectedUser}`);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});
