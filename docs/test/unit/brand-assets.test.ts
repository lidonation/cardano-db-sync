import fs from 'node:fs/promises';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

const BRAND = path.resolve(import.meta.dirname, '../../static/brand');

describe('published brand assets', () => {
  it('ships every PNG at its named dimensions', async () => {
    for (const variant of ['badge', 'blue', 'dark', 'white']) {
      for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024]) {
        const file = `mark-${variant}-${size}.png`;
        const bytes = await fs.readFile(path.join(BRAND, 'png', file));
        expect(bytes.subarray(0, 8).toString('hex'), file).toBe('89504e470d0a1a0a');
        expect(bytes.subarray(12, 16).toString(), file).toBe('IHDR');
        expect(bytes.readUInt32BE(16), file).toBe(size);
        expect(bytes.readUInt32BE(20), file).toBe(size);
      }
    }
  });

  it('renders the wordmarks without remote fonts or fallback text', async () => {
    const files = (await fs.readdir(path.join(BRAND, 'svg'))).filter((file) =>
      file.endsWith('.svg'),
    );
    expect(files).toHaveLength(7);
    for (const file of files) {
      const svg = await fs.readFile(path.join(BRAND, 'svg', file), 'utf8');
      expect(svg, file).not.toMatch(/@import|<script|<foreignObject|url\(|(?:href|src)=/i);
      if (file.startsWith('lockup-')) {
        expect(svg, file).not.toMatch(/<text\b/);
        expect(svg, file).toContain('<title>Cardano DB Sync</title>');
        expect(svg, file).toContain('role="img"');
      }
    }
  });
});
