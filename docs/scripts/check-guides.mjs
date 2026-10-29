#!/usr/bin/env node
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';

/** Validate contributor-authored CommonMark and current known entity declarations. */
export function validateGuide(name, source, schema, config) {
  const errors = [];
  if (!name.endsWith('.md')) return [`${name}: guide files must use .md`];
  const fail = (message) => errors.push(`${name}: ${message}`);
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(source);
  if (!match) return [`${name}: missing YAML frontmatter`];
  let front;
  try {
    front = yaml.load(match[1]);
  } catch {
    return [`${name}: invalid YAML frontmatter`];
  }
  if (!front || typeof front !== 'object' || Array.isArray(front))
    return [`${name}: frontmatter must be a mapping`];
  if (typeof front.title !== 'string' || !front.title.trim()) fail('title is required');
  if (typeof front.description !== 'string' || !front.description.trim())
    fail('description is required');
  for (const key of ['schema_range', 'schema_version', 'version_range', 'supported_versions']) {
    if (Object.hasOwn(front, key)) fail(`${key}: version range is derived, not handwritten`);
  }
  const requires = front.requires;
  if (!requires || typeof requires !== 'object' || Array.isArray(requires)) {
    fail('requires must be a mapping');
  } else {
    const configNames = new Set();
    function visitConfig(nodes, prefix = '') {
      for (const node of nodes ?? []) {
        const key = prefix ? `${prefix}.${node.name}` : node.name;
        configNames.add(key);
        visitConfig(node.shape?.keys, key);
      }
    }
    visitConfig(config.config?.keys);
    const tables = schema.tables ?? [];
    for (const key of Object.keys(requires))
      if (!['tables', 'columns', 'config'].includes(key)) fail(`unknown requires category ${key}`);
    for (const kind of ['tables', 'columns', 'config']) {
      const list = requires[kind];
      if (!Array.isArray(list) || list.some((value) => typeof value !== 'string' || !value)) {
        fail(`requires.${kind} must be a list of identifiers`);
        continue;
      }
      if (new Set(list).size !== list.length) fail(`duplicate requires.${kind} identifier`);
      for (const id of list) {
        let exists = false;
        if (kind === 'tables') exists = tables.some((table) => table.name === id);
        if (kind === 'columns') {
          const parts = id.split('.');
          exists =
            parts.length === 2 &&
            tables.some(
              (table) =>
                table.name === parts[0] && table.columns.some((column) => column.name === parts[1]),
            );
        }
        if (kind === 'config') exists = configNames.has(id);
        if (!exists) fail(`unknown ${kind} entity ${id}`);
      }
    }
  }
  let tree;
  try {
    tree = unified().use(remarkParse).use(remarkMdx).parse(source.slice(match[0].length));
  } catch (error) {
    fail(`invalid Markdown or MDX syntax: ${error.message}`);
    return errors;
  }
  function visit(node) {
    if (node.type.startsWith('mdx'))
      fail(`MDX syntax is not allowed (line ${node.position?.start?.line ?? '?'})`);
    if (node.type === 'html')
      fail(`raw HTML or JSX is not allowed (line ${node.position?.start?.line ?? '?'})`);
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return errors;
}

export function main(root = process.cwd()) {
  const schema = JSON.parse(readFileSync(path.join(root, 'generated/schema.json'), 'utf8'));
  const config = JSON.parse(readFileSync(path.join(root, 'generated/config-schema.json'), 'utf8'));
  const directory = path.join(root, 'docs/guides');
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.mdx?$/.test(file)) files.push(file);
    }
  }
  walk(directory);
  // Legacy conversions are staged but not yet published; validate them as well.
  const staged = path.join(root, 'migration/guides');
  if (existsSync(staged)) walk(staged);
  const errors = files.flatMap((file) =>
    validateGuide(path.relative(root, file), readFileSync(file, 'utf8'), schema, config),
  );
  if (errors.length) {
    console.error(errors.join('\n'));
    return 1;
  }
  console.log(`check:guides - ${files.length} guides use CommonMark and known entities`);
  return 0;
}
if (process.argv[1] === import.meta.filename) process.exitCode = main();
