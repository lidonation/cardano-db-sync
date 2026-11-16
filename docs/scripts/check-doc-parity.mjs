#!/usr/bin/env node
/** B16 / CON-6: read-only, heading-level migration audit. See ../doc-parity.md. */
import {createHash} from 'node:crypto';
import {lstatSync, readdirSync, readFileSync, realpathSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import yaml from 'js-yaml';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim() !== '';
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const normalize = (s) => s.replace(/\r\n?/g, '\n').trim();
export const digest = (s) => createHash('sha256').update(normalize(s)).digest('hex');
const inlineText = (n) => n.value ?? n.alt ?? (n.children ?? []).map(inlineText).join('');

/** Stable identity and direct/subtree content hashes; ignores code-fence pseudo-headings. */
export function readHeadings(source, frontmatter = false) {
  let body = source.replace(/\r\n?/g, '\n');
  if (frontmatter) body = body.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '');
  const nodes = [];
  function visit(n) {
    if (n.type === 'heading') nodes.push(n);
    for (const child of n.children ?? []) visit(child);
  }
  visit(unified().use(remarkParse).parse(body));
  const seen = new Set();
  const headings = nodes.map((n, index) => {
    const label = `h${n.depth} ${inlineText(n).replace(/\s+/g, ' ').trim()}`;
    let id = label;
    for (let count = 2; seen.has(id); count++) id = `${label} [${count}]`;
    seen.add(id);
    const start = n.position.start.offset;
    const end = nodes[index + 1]?.position.start.offset ?? body.length;
    const subtreeEnd =
      nodes.slice(index + 1).find((next) => next.depth <= n.depth)?.position.start.offset ??
      body.length;
    return {
      id,
      sha256: digest(body.slice(start, end)),
      subtreeSha256: digest(body.slice(start, subtreeEnd)),
    };
  });
  return {
    preambleSha256: digest(body.slice(0, nodes[0]?.position.start.offset ?? body.length)),
    headings,
  };
}

/** Exclude location metadata: moving a declaration must not invalidate migration evidence. */
export function annotationText(entry) {
  return JSON.stringify({
    name: entry.name,
    doc: normalize(entry.doc),
    constructors: (entry.constructors ?? []).map((ctor) => ({
      name: ctor.name,
      doc: normalize(ctor.doc),
      fields: (ctor.fields ?? []).map((field) => ({name: field.name, doc: normalize(field.doc)})),
    })),
  });
}

/** All reads stay inside this repository; reject traversal, non-files and symlink leaves. */
function readRepoFile(root, file) {
  if (
    !text(file) ||
    path.isAbsolute(file) ||
    file.includes('\\') ||
    file.split('/').some((s) => ['..', '.', ''].includes(s))
  )
    throw new Error('path must be repository-relative without traversal');
  const absolute = path.join(root, file);
  const relative = path.relative(realpathSync(root), realpathSync(absolute));
  if (relative.startsWith('..') || path.isAbsolute(relative) || !lstatSync(absolute).isFile())
    throw new Error('path must be a regular file inside the repository');
  return readFileSync(absolute, 'utf8');
}
function inventory(root) {
  const files = [];
  function walk(directory) {
    if (!lstatSync(directory).isDirectory())
      throw new Error('legacy doc directory must not be a symlink');
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile())
        files.push(path.relative(path.join(root, 'doc'), file).split(path.sep).join('/'));
      else throw new Error(`${entry.name}: unsupported legacy entry (symlinks are not permitted)`);
    }
  }
  walk(path.join(root, 'doc'));
  return files.sort();
}

export function audit(docsRoot) {
  const root = path.resolve(docsRoot, '..');
  const problems = [];
  const rows = [];
  const result = () => ({
    problems,
    rows,
    total: rows.length,
    accounted: rows.filter((row) => row.status !== 'FAIL').length,
    targets: object(manifest?.targets) ? manifest.targets : {},
    fileOmissions: Array.isArray(triage)
      ? triage.filter(
          (entry) =>
            object(entry) &&
            entry.disposition === 'omission' &&
            text(entry.file) &&
            !/\.md$/i.test(entry.file),
        )
      : [],
  });
  let manifest, triage, artifact, files;
  try {
    manifest = JSON.parse(readRepoFile(root, 'docs/data/doc-parity.json'));
    triage = JSON.parse(readRepoFile(root, 'docs/data/doc-triage.json'));
    artifact = JSON.parse(readRepoFile(root, 'docs/generated/haddock-annotations.json'));
    files = inventory(root);
  } catch (error) {
    problems.push(`Cannot audit migration: ${error.message}`);
    return result();
  }
  if (
    !object(manifest) ||
    manifest.schemaVersion !== 1 ||
    !object(manifest.sources) ||
    !object(manifest.targets)
  ) {
    problems.push('doc-parity.json must contain schemaVersion 1, sources and targets objects');
    return result();
  }
  if (!Array.isArray(triage) || !object(artifact) || !Array.isArray(artifact.files)) {
    problems.push('B13 triage must be an array and the annotation artifact must contain files');
    return result();
  }
  const dispositions = new Map();
  for (const entry of triage) {
    if (
      !object(entry) ||
      !text(entry.file) ||
      !['guide', 'annotation', 'both', 'omission'].includes(entry.disposition) ||
      !text(entry.reason)
    ) {
      problems.push('B13 triage entry needs a file, valid disposition and reason');
      continue;
    }
    if (dispositions.has(entry.file)) problems.push(`B13 duplicate file: ${entry.file}`);
    dispositions.set(entry.file, entry);
  }
  for (const file of files)
    if (!dispositions.has(file)) problems.push(`doc/${file}: unaccounted file, missing B13 triage`);
  for (const file of dispositions.keys())
    if (!files.includes(file)) problems.push(`doc/${file}: B13 source file is missing`);
  const markdown = files.filter((file) => /\.md$/i.test(file));
  for (const file of Object.keys(manifest.sources))
    if (!markdown.includes(file))
      problems.push(`doc/${file}: stale source mapping (not a current Markdown file)`);

  const guideHeadings = new Map();
  const targetResults = new Map();
  const usedTargets = new Set();
  function resolve(id) {
    if (targetResults.has(id)) return targetResults.get(id);
    const target = manifest.targets[id];
    let error = null;
    try {
      if (!object(target) || !['guide', 'annotation'].includes(target.kind) || !hash(target.sha256))
        throw new Error('target needs a valid kind and SHA-256');
      const contents = readRepoFile(root, target.file);
      if (target.kind === 'guide') {
        if (
          !target.file.startsWith('docs/docs/guides/') ||
          !target.file.endsWith('.md') ||
          !text(target.heading)
        )
          throw new Error('guide target must select a heading in published docs/docs/guides/*.md');
        const front = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(contents.replace(/\r\n?/g, '\n'));
        const metadata = front ? yaml.load(front[1]) : null;
        if (
          !object(metadata) ||
          metadata.draft === true ||
          target.file.split('/').some((part) => part.startsWith('_') || part.startsWith('.'))
        )
          throw new Error('guide target must be published, not draft or excluded');
        if (!guideHeadings.has(target.file))
          guideHeadings.set(target.file, readHeadings(contents, true).headings);
        const heading = guideHeadings.get(target.file).find((h) => h.id === target.heading);
        if (!heading) throw new Error(`migrated heading missing: ${target.heading}`);
        if (heading.subtreeSha256 !== target.sha256)
          throw new Error(`migrated section changed: ${target.heading}`);
      } else {
        if (!target.file.endsWith('.hs') || !text(target.name))
          throw new Error('annotation target must select a Haskell declaration');
        const module = artifact.files.find((file) => file?.path === target.file);
        const matches = Array.isArray(module?.annotations)
          ? module.annotations.filter((entry) => entry?.name === target.name)
          : [];
        if (!matches.length) throw new Error(`annotation missing: ${target.name}`);
        // CPP can yield identical declarations in separate branches. Check every copy.
        if (
          matches.some(
            (entry) => !text(entry.doc) || digest(annotationText(entry)) !== target.sha256,
          )
        )
          throw new Error(`annotation documentation changed: ${target.name}`);
      }
    } catch (failure) {
      error = failure.message;
    }
    const resolved = {kind: target?.kind, error};
    targetResults.set(id, resolved);
    return resolved;
  }

  for (const file of markdown) {
    const at = `doc/${file}`;
    const old = manifest.sources[file];
    let current;
    try {
      current = readHeadings(readRepoFile(root, at));
    } catch (error) {
      problems.push(`${at}: ${error.message}`);
      continue;
    }
    const valid = object(old) && hash(old.preambleSha256) && object(old.headings);
    if (!valid)
      problems.push(`${at}: missing/invalid source record (preambleSha256 and headings required)`);
    else if (old.preambleSha256 !== current.preambleSha256)
      problems.push(`${at}: source preamble changed`);
    const previous = valid ? old.headings : {};
    const present = new Set(current.headings.map((h) => h.id));
    const kinds = new Set();
    for (const heading of current.headings) {
      const label = `${at} — ${heading.id}`;
      const before = problems.length;
      const entry = previous[heading.id];
      let detail = '';
      let status = 'MAPPED';
      if (!object(entry) || !hash(entry.sha256))
        problems.push(`${label}: heading has no valid parity mapping`);
      else {
        if (entry.sha256 !== heading.sha256)
          problems.push(`${label}: source section changed; review its migration`);
        const omitted = Object.hasOwn(entry, 'omission');
        if (omitted === Object.hasOwn(entry, 'targets'))
          problems.push(`${label}: use exactly one of targets or omission`);
        else if (omitted) {
          status = 'OMITTED';
          detail = entry.omission;
          if (!text(entry.omission)) problems.push(`${label}: accepted omission needs a reason`);
          if (
            dispositions.get(file)?.disposition === 'omission' &&
            entry.omission !== dispositions.get(file).reason
          )
            problems.push(`${label}: omission reason disagrees with B13`);
        } else if (
          !Array.isArray(entry.targets) ||
          entry.targets.length === 0 ||
          entry.targets.some((id) => !text(id)) ||
          new Set(entry.targets).size !== entry.targets.length
        )
          problems.push(`${label}: targets must be a non-empty unique array of IDs`);
        else {
          detail = entry.targets.join(', ');
          for (const id of entry.targets) {
            usedTargets.add(id);
            if (!Object.hasOwn(manifest.targets, id)) {
              problems.push(`${label}: unknown target ${id}`);
              continue;
            }
            const target = resolve(id);
            if (target.error) problems.push(`${label}: ${id}: ${target.error}`);
            else kinds.add(target.kind);
          }
          if (dispositions.get(file)?.disposition === 'omission')
            problems.push(`${label}: B13 accepts omission, not a migrated target`);
        }
      }
      rows.push({
        file,
        heading: heading.id,
        status: before === problems.length ? status : 'FAIL',
        detail,
      });
    }
    for (const heading of Object.keys(previous))
      if (!present.has(heading)) {
        problems.push(`${at} — ${heading}: legacy heading missing (stale mapping)`);
        rows.push({file, heading, status: 'FAIL', detail: 'Legacy heading missing'});
      }
    const disposition = dispositions.get(file)?.disposition;
    const expected =
      disposition === 'both'
        ? ['guide', 'annotation']
        : ['guide', 'annotation'].includes(disposition)
          ? [disposition]
          : [];
    if (expected.some((kind) => !kinds.has(kind)))
      problems.push(
        `${at}: B13 disposition ${disposition} requires ${expected.join(' and ')} destinations`,
      );
  }
  for (const id of Object.keys(manifest.targets))
    if (!usedTargets.has(id)) problems.push(`Unused/stale target ${id}`);
  return result();
}

const cell = (value) =>
  (typeof value === 'string' ? value : (JSON.stringify(value) ?? '<missing>'))
    .replaceAll('|', '\\|')
    .replaceAll('`', '\\`')
    .replace(/\r?\n/g, ' ')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
/** @param {string} root @param {{log: (message: string) => unknown}} out */
export function main(root = path.resolve(import.meta.dirname, '..'), out = console) {
  const result = audit(root);
  const percent = result.total ? Math.floor((result.accounted / result.total) * 100) : 0;
  const lines = [
    '# Legacy documentation parity (B16 / CON-6)',
    '',
    `**${result.problems.length ? 'FAIL' : 'PASS'}** — ${result.accounted}/${result.total} headings accounted for (${percent}%).`,
    '',
    'Coverage is against reviewed mappings, not a semantic-equivalence proof.',
    '',
  ];
  if (result.problems.length)
    lines.push('## Problems', '', ...result.problems.map((problem) => `- ${cell(problem)}`), '');
  lines.push(
    '## Heading dispositions',
    '',
    '| Legacy file | Heading | Status | Destination IDs / omission reason |',
    '| --- | --- | --- | --- |',
  );
  for (const row of result.rows)
    lines.push(
      `| ${cell(row.file)} | ${cell(row.heading)} | ${row.status} | ${cell(row.detail)} |`,
    );
  lines.push(
    '',
    '## Destination definitions',
    '',
    '| ID | Kind | Repository file | Selector | SHA-256 |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const [id, target] of Object.entries(result.targets).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (object(target))
      lines.push(
        `| ${cell(id)} | ${cell(target.kind)} | ${cell(target.file)} | ${cell(target.heading ?? target.name)} | ${cell(target.sha256)} |`,
      );
  }
  if (result.fileOmissions.length) {
    lines.push('', '## Non-Markdown omissions (B13)', '');
    for (const entry of result.fileOmissions)
      lines.push(`- ${cell(entry.file)}: ${cell(entry.reason)}`);
  }
  out.log(lines.join('\n'));
  return result.problems.length ? 1 : 0;
}
if (process.argv[1] === import.meta.filename) process.exitCode = main();
