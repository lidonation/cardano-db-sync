import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const root = path.resolve(import.meta.dirname, '../../src/components/Card');
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

describe('card stylesheet ownership (PERF-1)', () => {
  it('keeps selectable card rules out of the shared frame stylesheet', () => {
    expect(read('styles.module.css')).not.toMatch(/\.(?:select|tick|switch|knob|track)\b/);
    expect(read('Select.tsx')).toContain("import selectStyles from './select.module.css'");
    const css = read('select.module.css');
    expect(css).toContain("composes: card from './styles.module.css'");
    expect(css).toContain('.select:has(.input:focus-visible)');
    expect(css).toContain("[dir='rtl']");
  });
  it('keeps the production barrel free of inventory-only card imports', () => {
    expect(read('index.tsx')).not.toMatch(/from ['"]\.\/(?:Select|Stat|SampleQuery)['"]/);
    expect(read('Frame.tsx')).not.toContain('select.module.css');
    expect(read('Frame.tsx')).not.toContain('stat.module.css');
  });
  it('owns decorative stat bars in the stat stylesheet', () => {
    expect(read('styles.module.css')).not.toMatch(/\.bar(?:Track|Fill)?\b/);
    expect(read('Stat.tsx')).toContain("import statStyles from './stat.module.css'");
    expect(read('stat.module.css')).toContain('.barFill');
  });
});
