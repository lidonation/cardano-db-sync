import {describe, expect, it} from 'vitest';
import {deriveMetadata, parseMetadataFrontMatter} from '../../plugins/metadata/markdown.mjs';

describe('remark metadata (CON-3, CONTENT-4)', () => {
  it('uses the h1 and complete lead, not formatting, code, alerts or frontmatter duplication', async () => {
    const content =
      '# Query `tx_out`\n\nA **whole** lead with [links](https://example.test),\nand a second line.\n\n## Run it\n\nRun `select`.';
    expect(deriveMetadata(content)).toMatchObject({
      title: 'Query tx_out',
      description: 'A whole lead with links, and a second line.',
    });
    const defaultParseFrontMatter = async () => ({
      content,
      frontMatter: {
        title: 'stale',
        description: 'stale',
        sidebar_label: 'Queries',
        requires: {tables: []},
      },
    });
    const result = await parseMetadataFrontMatter({
      filePath: '/docs/query.md',
      fileContent: content,
      defaultParseFrontMatter,
    });
    expect(result.frontMatter).toMatchObject({
      title: 'Query tx_out',
      description: 'A whole lead with links, and a second line.',
      sidebar_label: 'Queries',
      requires: {tables: []},
    });
    expect(result.content).toBe(content);
  });
  it('supports setext, nested inline nodes, unicode, and sidebar-title fallback', () => {
    expect(deriveMetadata('日本語 *title*\n===\n\nA ![diagram](x.webp) and `code`.')).toMatchObject(
      {title: '日本語 title', description: 'A diagram and code.'},
    );
    expect(deriveMetadata('Lead without a heading.', 'Sidebar label').title).toBe('Sidebar label');
  });
  it('fails clearly for multiple h1s, missing title and missing lead', () => {
    expect(() => deriveMetadata('# A\n\nLead.\n\n# B')).toThrow(/one h1/);
    expect(() => deriveMetadata('Lead.')).toThrow(/title/);
    expect(() => deriveMetadata('# A\n\n```sh\nnot a description\n```')).toThrow(/lead paragraph/);
  });
  it('gets ordered HowTo sections from the same AST, not authored JSON-LD', () => {
    expect(
      deriveMetadata(
        '# Install\n\nInstall safely.\n\n## Prepare\n\nChoose a release.\n\n## Run\n\nStart **once**.',
      ).steps,
    ).toEqual([
      {name: 'Prepare', text: 'Choose a release.'},
      {name: 'Run', text: 'Start once.'},
    ]);
  });
});

it('preserves existing navigation labels while deriving the page title from its h1', async () => {
  const content = '# Cardano DB Sync\n\nA complete lead.';
  const result = await parseMetadataFrontMatter({
    fileContent: content,
    filePath: 'intro.md',
    defaultParseFrontMatter: async () => ({content, frontMatter: {title: 'Introduction'}}),
  });
  expect(result.frontMatter).toMatchObject({
    title: 'Cardano DB Sync',
    sidebar_label: 'Introduction',
  });
});

it('keeps complete lead descriptions while compacting only HowTo section excerpts', async () => {
  const lead = 'A complete lead. '.repeat(30).trim();
  const content = `# Guide\n\n${lead}\n\n## Step\n\n${'Instruction. '.repeat(40)}`.replaceAll(
    '\\n',
    '\n',
  );
  const result = await parseMetadataFrontMatter({
    filePath: 'guide.md',
    fileContent: content,
    defaultParseFrontMatter: async () => ({content, frontMatter: {}}),
  });
  expect(result.frontMatter.description).toBe(lead);
  expect(result.frontMatter.metadata_steps[0].text).toHaveLength(120);
});
