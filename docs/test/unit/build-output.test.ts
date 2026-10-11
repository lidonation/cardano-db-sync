import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {lineIndex, profileOutputs} from '../../scripts/lib/build-output.mjs';

describe('lineIndex', () => {
  it('maps offsets to 1-based lines', () => {
    const text = 'ab\ncd\n\nef';
    const lineAt = lineIndex(text);
    expect([0, 2, 3, 6, 7, 8].map(lineAt)).toEqual([1, 1, 2, 3, 4, 4]);
  });

  it('is line 1 throughout text with no newline', () => {
    expect(lineIndex('abc')(2)).toBe(1);
  });
});

describe('profileOutputs', () => {
  it('lists subdirectories in order and ignores files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dbsync-out-'));
    try {
      await fs.mkdir(path.join(root, 'prod'));
      await fs.mkdir(path.join(root, 'dev'));
      await fs.writeFile(path.join(root, 'stray.txt'), '');
      expect(await profileOutputs(root)).toEqual([path.join(root, 'dev'), path.join(root, 'prod')]);
    } finally {
      await fs.rm(root, {recursive: true, force: true});
    }
  });

  it('is empty when there is no build directory', async () => {
    expect(await profileOutputs(path.join(os.tmpdir(), 'dbsync-no-such-dir'))).toEqual([]);
  });
});
