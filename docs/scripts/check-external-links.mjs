#!/usr/bin/env node
/**
 * External link check for the Ecosystem page (B44-b).
 *
 * The site's link gate (`check-links.mjs`, BLD-3) never fetches external links, so someone else's
 * outage cannot fail an unrelated pull request. The Ecosystem page is different: it is a list of
 * other people's projects, and its value is that every entry still resolves. This check fetches
 * every https URL the page's sources name, and runs where a failure means something:
 *
 *   - on pull requests that change those sources, so a new or edited entry is checked before it
 *     lands;
 *   - weekly, ending in the ops alert (NUM-4), so a project that moves or disappears is noticed.
 *
 * Usage: node scripts/check-external-links.mjs [file …]. With no arguments it reads the Ecosystem
 * sources. Exit 0 when every URL answers 2xx (after redirects), 1 when any does not. A server that
 * still rate-limits (429) after the retry is answering, so it is reported as a warning, not a
 * broken link.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The files whose links the Ecosystem page renders. */
export const SOURCES = [
  'src/ecosystem/entries.ts',
  'src/ecosystem/Ecosystem.tsx',
  'src/data/links.ts',
];

/** Constants the sources interpolate, read from `src/data/links.ts`. */
export async function linkConstants(file = path.join(ROOT, 'src/data/links.ts')) {
  const text = await readFile(file, 'utf8');
  return Object.fromEntries(
    [...text.matchAll(/export const (\w+) = '([^']+)'/g)].map((match) => [match[1], match[2]]),
  );
}

/**
 * Every https URL a source names: plain string literals, and template literals whose only
 * interpolations are the shared link constants.
 *
 * @param {string} text
 * @param {Record<string, string>} constants
 * @returns {string[]}
 */
export function externalUrls(text, constants) {
  const urls = new Set();
  for (const match of text.matchAll(/'(https:\/\/[^'\s]+)'/g)) urls.add(match[1]);
  for (const match of text.matchAll(/`([^`]*)`/g)) {
    const resolved = match[1].replace(/\$\{(\w+)\}/g, (whole, name) => constants[name] ?? whole);
    if (resolved.startsWith('https://') && !resolved.includes('${')) urls.add(resolved);
  }
  return [...urls].sort();
}

/**
 * Fetch a URL: HEAD first, GET when the server refuses HEAD, one retry on a network error or a
 * 429/5xx. Resolves to the final status, or 0 when the server never answered.
 *
 * @param {string} url
 * @param {typeof fetch} http
 * @param {(ms: number) => Promise<void>} wait
 */
export async function status(
  url,
  http = globalThis.fetch,
  wait = (ms) => new Promise((r) => globalThis.setTimeout(r, ms)),
) {
  let last = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await wait(5000);
    for (const method of ['HEAD', 'GET']) {
      try {
        const response = await http(url, {
          method,
          redirect: 'follow',
          signal: globalThis.AbortSignal.timeout(20_000),
          headers: {'user-agent': 'cardano-db-sync-docs link check'},
        });
        last = response.status;
        // No page content is needed. Release GET bodies before returning or retrying.
        await response.body?.cancel();
        if (response.ok) return last;
        if (method === 'HEAD' && [403, 405, 501].includes(last)) continue;
        break;
      } catch {
        last = 0;
        break;
      }
    }
    if (last !== 0 && last !== 429 && last < 500) return last;
  }
  return last;
}

/**
 * @param {string[]} argv
 * @param {{http?: typeof fetch, wait?: (ms: number) => Promise<void>, out?: Pick<Console, 'log' | 'error'>}} deps
 */
export async function main(
  argv = process.argv.slice(2),
  {http = globalThis.fetch, wait, out = console} = {},
) {
  const files = argv.length ? argv : SOURCES.map((file) => path.join(ROOT, file));
  const constants = await linkConstants();
  const urls = new Set();
  for (const file of files) {
    for (const url of externalUrls(await readFile(file, 'utf8'), constants)) urls.add(url);
  }
  if (urls.size === 0) {
    out.error('check:external-links - no external links found; check the source list.');
    return 1;
  }
  const broken = [];
  let unverified = 0;
  for (const url of [...urls].sort()) {
    const code = await status(url, http, wait);
    if (code === 429) {
      unverified++;
      out.log(`check:external-links - warning: ${url} is rate-limiting (429)`);
    } else if (code < 200 || code >= 300) broken.push(`${code || 'no answer'}  ${url}`);
  }
  if (broken.length) {
    out.error(`check:external-links - ${broken.length} of ${urls.size} link(s) broken:\n`);
    for (const line of broken) out.error(`  ${line}`);
    return 1;
  }
  out.log(
    unverified
      ? `check:external-links - ${urls.size - unverified} links resolve; ${unverified} unverified (429).`
      : `check:external-links - all ${urls.size} external links resolve.`,
  );
  return 0;
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
