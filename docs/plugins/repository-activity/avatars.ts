import {createHash} from 'node:crypto';
import {mkdir, readdir, unlink, writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import path from 'node:path';
import type {Profile} from './data';

const MAX_BYTES = 1024 * 1024;
function extension(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.slice(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.slice(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.slice(8, 12)).toString() === 'WEBP'
  )
    return 'webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(Buffer.from(bytes.slice(0, 6)).toString()))
    return 'gif';
  return null;
}

/** Untrusted profile URLs may only name GitHub's avatar CDN; no redirects, SVG, or large bodies. */
export async function downloadAvatar(
  profile: Profile,
  dir: string,
  send: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const url = new URL(profile.avatarUrl);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'avatars.githubusercontent.com' ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    const response = await send(url, {redirect: 'error', signal: AbortSignal.timeout(10000)});
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
    const bytes = Buffer.concat(parts);
    if (!extension(bytes)) return null;
    const image = await sharp(bytes, {limitInputPixels: 4_000_000, failOn: 'error'})
      .resize(92, 92, {fit: 'cover'})
      .webp({quality: 65})
      .toBuffer();
    const name = `${createHash('sha256').update(image).digest('hex')}.webp`;
    await mkdir(dir, {recursive: true});
    await writeFile(path.join(dir, name), image);
    return `/repository-avatars/${name}`;
  } catch {
    return null;
  }
}

/** Remove obsolete hashed images only after the new public snapshot is safely saved. */
export async function pruneAvatars(dir: string, usedPaths: readonly string[]): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const used = new Set(usedPaths.map((item) => path.basename(item)));
  await Promise.all(
    names
      .filter((name) => /^[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/.test(name) && !used.has(name))
      .map((name) => unlink(path.join(dir, name))),
  );
}
