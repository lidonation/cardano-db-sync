import {describe, expect, it} from 'vitest';

import {nextTab} from '../../src/components/Tabs/keyboard';

describe('tab keyboard movement (A11Y-28)', () => {
  const all = [true, true, true, true];

  it('steps and wraps with the arrow keys', () => {
    expect(nextTab('ArrowRight', 0, all)).toBe(1);
    expect(nextTab('ArrowRight', 3, all)).toBe(0);
    expect(nextTab('ArrowLeft', 0, all)).toBe(3);
    expect(nextTab('ArrowLeft', 2, all)).toBe(1);
  });

  it('jumps with Home and End', () => {
    expect(nextTab('Home', 2, all)).toBe(0);
    expect(nextTab('End', 1, all)).toBe(3);
  });

  it('skips disabled tabs, including at the ends', () => {
    const enabled = [false, true, false, true];
    expect(nextTab('ArrowRight', 1, enabled)).toBe(3);
    expect(nextTab('ArrowRight', 3, enabled)).toBe(1);
    expect(nextTab('Home', 3, enabled)).toBe(1);
    expect(nextTab('End', 1, [true, true, false])).toBe(1);
  });

  it('swaps the horizontal keys in a right-to-left document (DF-8)', () => {
    expect(nextTab('ArrowLeft', 0, all, {rtl: true})).toBe(1);
    expect(nextTab('ArrowRight', 0, all, {rtl: true})).toBe(3);
  });

  it('uses Up and Down for a vertical list', () => {
    expect(nextTab('ArrowDown', 0, all, {orientation: 'vertical'})).toBe(1);
    expect(nextTab('ArrowUp', 0, all, {orientation: 'vertical'})).toBe(3);
    expect(nextTab('ArrowRight', 0, all, {orientation: 'vertical'})).toBeNull();
  });

  it('ignores other keys, and lists with nothing to move to', () => {
    expect(nextTab('Enter', 0, all)).toBeNull();
    expect(nextTab('ArrowRight', 0, [])).toBeNull();
    expect(nextTab('ArrowRight', 0, [false, false])).toBeNull();
  });
});
