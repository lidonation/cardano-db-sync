/**
 * What the CSP writer (`plugins/security`) and the CSP gate (`scripts/check-csp.mjs`) must agree
 * on: which inline scripts a browser executes, and how a script body is hashed (SEC-3).
 */
import {createHash} from 'node:crypto';

/**
 * `<script type>` values the browser runs, or treats as inline script under `script-src`. The HTML
 * standard's JavaScript MIME type essences, plus `module`, `importmap` and `speculationrules`. Any
 * other type (`application/ld+json`) is a data block and is not governed by the policy.
 */
const EXECUTABLE_TYPES = new Set([
  '',
  'module',
  'importmap',
  'speculationrules',
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

/** Every `<script>` element: its attribute source and its exact body. */
export const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * True when a `<script>` with these attributes is inline code the policy must allow: no `src`, and
 * a type the browser executes. The type is compared by MIME essence, so parameters and case do not
 * hide a script.
 *
 * @param {string} attrs
 */
export function isInlineExecutable(attrs) {
  if (/\ssrc\s*=/i.test(attrs)) {
    return false;
  }
  const raw = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i.exec(attrs);
  const type = (raw ? (raw[1] ?? raw[2] ?? raw[3]) : '').split(';')[0].trim().toLowerCase();
  return EXECUTABLE_TYPES.has(type);
}

/**
 * CSP source for a script body: `'sha256-<base64>'` of its exact UTF-8 bytes.
 *
 * @param {string} code
 */
export function hashSource(code) {
  return `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`;
}
