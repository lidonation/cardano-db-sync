import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import tokens from '../../design/tokens.source.json';
import {CONTENT_TYPES, type ContentType} from '../../src/metadata/types';

/** Text-free network art: semantic source tokens, per-type geometry, no extra font/image payload. */
export async function generateSocialImage(type: ContentType): Promise<Buffer> {
  const index = CONTENT_TYPES.indexOf(type);
  const {surface, accent, border} = tokens.base;
  const dots = Array.from({length: 6}, (_, i) => {
    const x = 220 + i * 150;
    const y = 220 + ((i + index) % 3) * 95;
    return `<path d="M${x - 50} ${y}h100m-50 -50v100" stroke="${border.strong}"/><circle cx="${x}" cy="${y}" r="${18 + index * 2}" fill="${i % 2 ? accent.secondary : accent.primary}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${surface.sunken}"/><path d="M0 540H1200M0 90H1200" stroke="${border.strong}"/>${dots}</svg>`;
  return sharp(Buffer.from(svg)).webp({lossless: true}).toBuffer();
}

export async function emitSocialImages(
  outDir: string,
  types: Iterable<ContentType>,
): Promise<void> {
  const dir = path.join(outDir, 'social');
  await mkdir(dir, {recursive: true});
  for (const type of [...new Set(types)].sort())
    await writeFile(path.join(dir, `${type}.webp`), await generateSocialImage(type));
}
