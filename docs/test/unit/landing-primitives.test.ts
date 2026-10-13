import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const source = (file: string) =>
  readFileSync(path.resolve(import.meta.dirname, '../../src', file), 'utf8');

describe('landing shared primitives', () => {
  it('uses one Command for the hero and quickstart, with both surface variants', () => {
    const landing = source('landing/Landing.tsx');
    expect(landing.match(/<Command /g)).toHaveLength(2);
    expect(landing).toContain('surface="raised"');
    expect(source('components/Command/styles.module.css')).toContain('--dbs-code-surface-raised');
    expect(source('components/Command/index.tsx')).toContain('variant="plain"');
  });

  it('uses shared hexagons, rail decorations and visually hidden feedback', () => {
    const landing = source('landing/Landing.tsx');
    expect(landing).toContain('shared.hexagon');
    expect(landing).toContain('<SectionDivider />');
    expect(landing).toContain('<SectionCross />');
    expect(source('components/CodeCopy/index.tsx')).toContain('hidden.visuallyHidden');
    expect(source('landing/styles.module.css')).not.toContain('clip-path');
  });

  it('keeps decorative icon sizes and strokes on the token system without inline style', () => {
    const icon = source('components/shared/Icon.tsx');
    expect(icon).toContain('data-size={size}');
    expect(icon).toContain('strokeWidth="var(--dbs-icon-stroke)"');
    expect(icon).not.toContain('style=');
    for (const step of ['xs', 'sm', 'md', 'lg', 'xl']) {
      expect(source('components/shared/Icon.module.css')).toContain(`--dbs-icon-size-${step}`);
    }
  });

  it('preserves legacy page imports by composing the shared link, not redrawing it', () => {
    expect(source('landing/styles.module.css')).toContain(
      "composes: link from '../components/TextLink/styles.module.css'",
    );
  });
});
