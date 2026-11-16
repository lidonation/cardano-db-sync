import {expect, it} from 'vitest';
import {FRONTMATTER} from '../../scripts/lib/frontmatter.mjs';
import {validateGuide} from '../../scripts/check-guides.mjs';
import {readHeadings} from '../../scripts/check-doc-parity.mjs';

it('shares one YAML frontmatter pattern between guide validation and parity', () => {
  expect(FRONTMATTER.exec('---\ntitle: A\n---\n\n# Body')?.[1]).toBe('title: A');
  expect(FRONTMATTER.exec('# No frontmatter\n---\n')).toBeNull();
  expect(validateGuide('a.md', '# No frontmatter\n', {}, {})).toEqual([
    'a.md: missing YAML frontmatter',
  ]);
  expect(readHeadings('---\ntitle: A\n---\n\n# Body', true).headings.map((h) => h.id)).toEqual([
    'h1 Body',
  ]);
});
