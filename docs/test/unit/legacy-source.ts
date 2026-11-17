import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

/** Repository root, so tests read the retired doc/ tree from its pinned commit (B17). */
const repoRoot = path.resolve(import.meta.dirname, '../../..');

/** The commit that still contains doc/, as pinned by the retirement policy. */
export const legacySourceCommit: string = JSON.parse(
  readFileSync(path.join(repoRoot, 'docs/data/doc-retirement.json'), 'utf8'),
).sourceCommit;

const git = (...args: string[]) => execFileSync('git', args, {cwd: repoRoot, encoding: 'utf8'});

/** One retired doc/ file, read from git rather than the removed working copy. */
export function readLegacy(file: string): string {
  return git('show', `${legacySourceCommit}:doc/${file}`);
}

/** Every file name in the retired, flat doc/ tree, sorted. */
export function listLegacy(): string[] {
  return git('ls-tree', '--name-only', `${legacySourceCommit}:doc`).trim().split('\n').sort();
}
