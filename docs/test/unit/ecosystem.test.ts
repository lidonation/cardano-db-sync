import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {ECOSYSTEM_IDS} from '../../src/ecosystem/ids';
import {ECOSYSTEM_TOOLS, toolProblem, toolsView} from '../../src/ecosystem/tools';

describe('ecosystem tools (B44-b)', () => {
  it('lists every tool well-formed, with https links on known hosts', () => {
    expect(ECOSYSTEM_TOOLS.length).toBeGreaterThan(0);
    for (const tool of ECOSYSTEM_TOOLS) {
      expect(toolProblem(tool), tool.name).toBeNull();
    }
  });

  it('names every tool once, and points each card somewhere its links do not', () => {
    const names = ECOSYSTEM_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of ECOSYSTEM_TOOLS) {
      expect(tool.website).not.toBe(tool.repository);
      expect(tool.repository).not.toBe(tool.queries);
    }
  });

  it('flags a non-https link, an unknown host and an unnamed queries link', () => {
    const [tool] = ECOSYSTEM_TOOLS;
    expect(toolProblem({...tool, website: 'http://koios.rest/'})).toMatch(/https/);
    expect(toolProblem({...tool, website: 'https://example.com/'})).toMatch(/unknown host/);
    expect(toolProblem({...tool, website: 'not a url'})).toMatch(/not a URL/);
    expect(toolProblem({...tool, queriesLabel: '  '})).toMatch(/CONTENT-5/);
    expect(toolProblem({...tool, name: ''})).toMatch(/non-empty/);
  });

  it('renders the list view, or the named empty state when there is nothing yet', () => {
    expect(toolsView(ECOSYSTEM_TOOLS)).toEqual({kind: 'list', tools: ECOSYSTEM_TOOLS});
    expect(toolsView([])).toEqual({kind: 'empty'});
  });
});

describe('ecosystem language marking (A11Y-18)', () => {
  it('lists exactly the string ids the ecosystem page renders', () => {
    const dir = path.resolve(import.meta.dirname, '../../src/ecosystem');
    const source = readdirSync(dir)
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => readFileSync(path.join(dir, file), 'utf8'))
      .join('\n');
    const used = new Set(
      [...source.matchAll(/id: '(ecosystem\.[^']+)'/g)].map((match) => match[1]),
    );
    expect([...ECOSYSTEM_IDS].sort()).toEqual([...used].sort());
  });
});
