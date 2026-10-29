import {expect, it} from 'vitest';
import {safeGuideHref, safeGuideRequest} from '../../src/components/StaticGuide/security';

it('rejects executable and malformed link protocols while retaining ordinary links', () => {
  for (const bad of [
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    '\njava\tscript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'http://[bad',
  ])
    expect(safeGuideHref(bad, 'https://example.test')).toBe(false);
  for (const good of [
    '/docs/a',
    '#section',
    'https://other.test/docs',
    'http://example.test',
    'mailto:help@example.test',
    'tel:+123',
  ])
    expect(safeGuideHref(good, 'https://example.test')).toBe(true);
});
it('only fetches a same-origin HTTP guide', () => {
  expect(safeGuideRequest('/docs/a', 'https://example.test')).toBe(true);
  for (const bad of [
    'https://evil.test/docs',
    '//evil.test/docs',
    'javascript:alert(1)',
    'http://example.test/docs',
  ])
    expect(safeGuideRequest(bad, 'https://example.test')).toBe(false);
});

it('only allows self or protected new-window targets', async () => {
  const {safeGuideTarget} = await import('../../src/components/StaticGuide/security');
  expect(safeGuideTarget(null, null)).toBe(true);
  expect(safeGuideTarget('_self', null)).toBe(true);
  expect(safeGuideTarget('_blank', 'noopener')).toBe(true);
  expect(safeGuideTarget('_BLANK', 'NOOPENER')).toBe(true);
  expect(safeGuideTarget('_blank', 'noopener-evil')).toBe(false);
  expect(safeGuideTarget('named-window', null)).toBe(false);
});
