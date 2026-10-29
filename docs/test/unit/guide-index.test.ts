import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {expect, it} from 'vitest';

it('lists every published guide from a CommonMark guide index', () => {
  const dir = path.resolve(import.meta.dirname, '../../docs/guides');
  const text = readFileSync(path.join(dir, 'index.md'), 'utf8');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  expect(front).not.toBeNull();
  const metadata = yaml.load(front![1]) as {
    slug: string;
    requires: {tables: string[]; columns: string[]; config: string[]};
  };
  expect(metadata.slug).toBe('/guides');
  expect(metadata.requires).toEqual({tables: [], columns: [], config: []});
  for (const file of readdirSync(dir).filter(
    (name) => name.endsWith('.md') && name !== 'index.md',
  )) {
    expect(text, file).toContain(`./${file}`);
  }
});
