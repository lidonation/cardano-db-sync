import {readFileSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {describe, expect, it} from 'vitest';

const file = path.resolve(import.meta.dirname, '../../guide-template.md');

describe('contributor guide template (CON-8, CON-12, GDE-1)', () => {
  it('provides valid frontmatter with explicit entity dependencies', () => {
    const text = readFileSync(file, 'utf8');
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(match).not.toBeNull();
    const frontmatter = yaml.load(match![1]) as {
      title: string;
      description: string;
      requires: Record<string, unknown>;
    };
    expect(frontmatter.title).toBeTruthy();
    expect(frontmatter.description).toBeTruthy();
    expect(Object.keys(frontmatter.requires).sort()).toEqual(['columns', 'config', 'tables']);
    for (const list of Object.values(frontmatter.requires)) expect(Array.isArray(list)).toBe(true);
    expect(frontmatter).not.toHaveProperty('version');
  });

  it('explains CommonMark, dependencies and review to a contributor', () => {
    const text = readFileSync(file, 'utf8');
    expect(text).toMatch(/CommonMark/i);
    expect(text).toMatch(/GitHub/);
    expect(text).toMatch(/no JSX/i);
    expect(text).toMatch(/schema range/i);
    expect(text).toMatch(/prerequisites/i);
    expect(text).toMatch(/verification/i);
    expect(text).toMatch(/troubleshooting/i);
  });
});
