import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {downloadAvatar, pruneAvatars} from '../../plugins/repository-activity/avatars';

const profile = {
  login: 'alice',
  name: 'Alice',
  location: null,
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
};
describe('avatar isolation', () => {
  it('accepts a bounded raster image and names it by content', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'avatar-'));
    try {
      const png = await readFile(
        'test/fixtures/repository-activity/avatars/' + 'c'.repeat(64) + '.png',
      );
      const send = vi.fn(async () => new Response(png));
      const result = await downloadAvatar(profile, dir, send as typeof fetch);
      expect(result).toMatch(/^\/repository-avatars\/[a-f0-9]{64}\.webp$/);
      expect(await readdir(dir)).toHaveLength(1);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });
  it('refuses external hosts, SVGs and oversized images', async () => {
    const send = vi.fn(async () => new Response('<svg/>'));
    expect(
      await downloadAvatar(
        {...profile, avatarUrl: 'https://evil.example/a'},
        '/tmp',
        send as typeof fetch,
      ),
    ).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(await downloadAvatar(profile, '/tmp', send as typeof fetch)).toBeNull();
    const big = vi.fn(async () => new Response(new Uint8Array(1024 * 1024 + 1)));
    expect(await downloadAvatar(profile, '/tmp', big as typeof fetch)).toBeNull();
  });
  it('prunes only obsolete content-addressed images after a successful refresh', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'avatar-prune-'));
    try {
      const old = 'a'.repeat(64) + '.png';
      const kept = 'b'.repeat(64) + '.webp';
      await writeFile(path.join(dir, old), 'old');
      await writeFile(path.join(dir, kept), 'kept');
      await writeFile(path.join(dir, 'other.txt'), 'other');
      await pruneAvatars(dir, ['/repository-avatars/' + kept]);
      expect((await readdir(dir)).sort()).toEqual([kept, 'other.txt'].sort());
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });
});
