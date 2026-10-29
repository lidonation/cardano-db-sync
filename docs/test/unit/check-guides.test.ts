import {describe, expect, it, vi} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {main, validateGuide} from '../../scripts/check-guides.mjs';

const schema = {tables: [{name: 'tx_out', columns: [{name: 'value'}]}]};
const config = {config: {keys: [{name: 'insert_options', shape: {keys: [{name: 'tx_out'}]}}]}};
const guide = (
  requires = '  tables: [tx_out]\n  columns: [tx_out.value]\n  config: [insert_options.tx_out]',
  body = '# Guide\n',
) => `---\ntitle: Guide\ndescription: Description\nrequires:\n${requires}\n---\n\n${body}`;
describe('CommonMark and dependency gate', () => {
  it('accepts valid plain Markdown with known dependencies', () => {
    expect(validateGuide('example.md', guide(), schema, config)).toEqual([]);
  });
  it('rejects unknown tables, columns and config and duplicate declarations', () => {
    const errors = validateGuide(
      'example.md',
      guide(
        '  tables: [missing, tx_out, tx_out]\n  columns: [tx_out.missing]\n  config: [insert_options.missing]',
      ),
      schema,
      config,
    ).join('\n');
    expect(errors).toContain('missing');
    expect(errors).toContain('duplicate');
    expect(errors).toContain('tx_out.missing');
    expect(errors).toContain('insert_options.missing');
  });
  it('rejects JSX but permits code examples containing tags', () => {
    expect(
      validateGuide('example.md', guide(undefined, '<Widget />'), schema, config).join(),
    ).toMatch(/JSX|HTML|MDX/);
    expect(
      validateGuide('example.md', guide(undefined, '```html\n<Widget />\n```'), schema, config),
    ).toEqual([]);
  });
  it('rejects missing or malformed frontmatter and handwritten ranges', () => {
    expect(validateGuide('x.md', '# No frontmatter', schema, config).length).toBeGreaterThan(0);
    expect(validateGuide('x.md', '---\nrequires: [\n---\n', schema, config).length).toBeGreaterThan(
      0,
    );
    expect(
      validateGuide(
        'x.md',
        guide().replace('title: Guide', 'version_range: 1\ntitle: Guide'),
        schema,
        config,
      ).join(),
    ).toMatch(/range/);
  });
});

describe('guide gate edge cases', () => {
  it('checks title, description, structure and category names', () => {
    expect(validateGuide('x.md', '---\n- list\n---\n', schema, config).join()).toMatch(/mapping/);
    const missing = validateGuide(
      'x.md',
      '---\ntitle: ""\ndescription: ""\n---\n',
      schema,
      config,
    ).join();
    expect(missing).toMatch(/title/);
    expect(missing).toMatch(/description/);
    expect(missing).toMatch(/requires/);
    const invalid = validateGuide(
      'x.md',
      guide('  tables: bad\n  columns: [4]\n  config: [""]\n  other: []'),
      schema,
      config,
    ).join();
    expect(invalid).toMatch(/other/);
    expect(invalid).toMatch(/tables/);
    expect(invalid).toMatch(/columns/);
    expect(invalid).toMatch(/config/);
  });
  it('rejects multiple version-range aliases and malformed column paths', () => {
    for (const key of ['schema_range', 'schema_version', 'supported_versions']) {
      expect(
        validateGuide(
          'x.md',
          guide().replace('title: Guide', `${key}: 1\ntitle: Guide`),
          schema,
          config,
        ).join(),
      ).toContain(key);
    }
    expect(
      validateGuide(
        'x.md',
        guide('  tables: []\n  columns: [tx_out.value.extra]\n  config: []'),
        schema,
        config,
      ).join(),
    ).toContain('tx_out.value.extra');
  });
});

it('walks nested guide files and returns failure when validation fails', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'guide-gate-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    mkdirSync(path.join(root, 'generated'));
    mkdirSync(path.join(root, 'docs/guides/nested'), {recursive: true});
    writeFileSync(path.join(root, 'generated/schema.json'), JSON.stringify(schema));
    writeFileSync(path.join(root, 'generated/config-schema.json'), JSON.stringify(config));
    writeFileSync(path.join(root, 'docs/guides/nested/example.md'), guide());
    writeFileSync(path.join(root, 'docs/guides/nested/ignored.txt'), 'ignored');
    expect(main(root)).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 guides'));
    writeFileSync(path.join(root, 'docs/guides/nested/example.md'), '# no frontmatter');
    expect(main(root)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('missing YAML'));
  } finally {
    log.mockRestore();
    error.mockRestore();
    rmSync(root, {recursive: true, force: true});
  }
});

it('rejects MDX expressions, module syntax and .mdx source files', () => {
  expect(
    validateGuide(
      'guide.md',
      guide(undefined, 'Value: {process.env.SECRET}'),
      schema,
      config,
    ).join(),
  ).toMatch(/MDX/);
  expect(
    validateGuide('guide.md', guide(undefined, "import X from 'module'\n"), schema, config).join(),
  ).toMatch(/MDX/);
  expect(validateGuide('guide.mdx', guide(), schema, config).join()).toMatch(/\.md/);
});

it('runs guide validation before each published profile build', async () => {
  const {readFileSync} = await import('node:fs');
  const scripts = (
    JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;
  expect(scripts['prebuild:dev']).toContain('check:guides');
  expect(scripts['prebuild:prod']).toContain('check:guides');
});

it('also validates converted legacy guides that are staged outside the published site', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'guide-staging-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    mkdirSync(path.join(root, 'generated'));
    mkdirSync(path.join(root, 'docs/guides'), {recursive: true});
    mkdirSync(path.join(root, 'migration/guides'), {recursive: true});
    writeFileSync(path.join(root, 'generated/schema.json'), JSON.stringify(schema));
    writeFileSync(path.join(root, 'generated/config-schema.json'), JSON.stringify(config));
    writeFileSync(
      path.join(root, 'migration/guides/legacy.md'),
      guide('  tables: [missing]\n  columns: []\n  config: []'),
    );
    expect(main(root)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unknown tables entity missing'));
  } finally {
    log.mockRestore();
    error.mockRestore();
    rmSync(root, {recursive: true, force: true});
  }
});
