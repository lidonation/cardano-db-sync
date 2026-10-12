import {describe, expect, it} from 'vitest';

import {nextMenuIndex} from '../../src/components/ThemeSwitcher/keyboard';

describe('theme menu keyboard (A11Y-29)', () => {
  it('steps down and up with wrap', () => {
    expect(nextMenuIndex('ArrowDown', 0, 4)).toBe(1);
    expect(nextMenuIndex('ArrowDown', 3, 4)).toBe(0);
    expect(nextMenuIndex('ArrowUp', 0, 4)).toBe(3);
    expect(nextMenuIndex('ArrowUp', 2, 4)).toBe(1);
  });

  it('jumps to first and last on Home and End', () => {
    expect(nextMenuIndex('Home', 2, 4)).toBe(0);
    expect(nextMenuIndex('End', 1, 4)).toBe(3);
  });

  it('ignores other keys and empty menus', () => {
    expect(nextMenuIndex('Enter', 0, 4)).toBeNull();
    expect(nextMenuIndex('Escape', 0, 4)).toBeNull();
    expect(nextMenuIndex('Tab', 0, 4)).toBeNull();
    expect(nextMenuIndex('ArrowDown', 0, 0)).toBeNull();
  });
});
