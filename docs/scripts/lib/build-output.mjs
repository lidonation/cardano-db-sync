/**
 * Helpers shared by the CI gate scripts: walking a directory tree, finding the profile outputs
 * under `build/`, and turning a character offset into a line number.
 */
import {readdir} from 'node:fs/promises';
import path from 'node:path';

/** Directories no gate scans, wherever they sit. */
export const SKIP_DIRS = new Set(['node_modules', 'build', '.docusaurus', 'coverage', '.git']);

/** The generated token stylesheet, relative to the docs root: the one place colours are defined. */
export const TOKENS_CSS = 'src/css/tokens.css';

/**
 * @typedef {{log: (message: string) => void, error: (message: string) => void}} Reporter
 *   Where a gate writes its report. `console` satisfies it.
 */

/**
 * Yield every file under `dir`, depth first.
 *
 * @param {string} dir
 * @param {(dir: string) => boolean} [skip] Return true to leave a directory out.
 * @returns {AsyncGenerator<string>}
 */
export async function* walk(dir, skip = () => false) {
  const entries = await readdir(dir, {withFileTypes: true});
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip(full)) {
        yield* walk(full, skip);
      }
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Every profile output under `build/`: one subdirectory per profile. A missing `build/` gives an
 * empty list, which each gate reports as "no build output".
 *
 * @param {string} buildDir
 * @returns {Promise<string[]>}
 */
export async function profileOutputs(buildDir) {
  try {
    const entries = await readdir(buildDir, {withFileTypes: true});
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(buildDir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Build a lookup from character offset to 1-based line number. The newline positions are found
 * once, so each lookup is a binary search instead of a rescan from the start of the text.
 *
 * @param {string} text
 * @returns {(offset: number) => number}
 */
export function lineIndex(text) {
  const newlines = [];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    newlines.push(i);
  }
  return (offset) => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < offset) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo + 1;
  };
}
