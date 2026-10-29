import {readFileSync} from 'node:fs';
import path from 'node:path';
import {expect, it} from 'vitest';

it('provides GitHub-readable labelled installation alternatives and practical sections', () => {
  const text = readFileSync(
    path.resolve(import.meta.dirname, '../../docs/guides/installation.md'),
    'utf8',
  );
  for (const section of [
    'Prerequisites',
    'Choose an installation method',
    'Verify',
    'Troubleshooting',
  ])
    expect(text).toContain(`## ${section}`);
  for (const label of ['Docker', 'nix', 'cabal']) expect(text).toContain(`tab="${label}"`);
  expect(text).toContain('requires:');
  expect(text).toContain('> [!NOTE]');
});

it('introduces the available guides rather than describing an empty scaffold', () => {
  const intro = readFileSync(path.resolve(import.meta.dirname, '../../docs/intro.md'), 'utf8');
  expect(intro).toContain('./guides/installation.md');
  expect(intro).not.toContain('content lands in later phases');
});
