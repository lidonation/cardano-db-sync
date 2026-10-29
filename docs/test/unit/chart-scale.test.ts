import {describe, expect, it} from 'vitest';
import {linearScale} from '../../src/components/Chart/scale';

describe('shared chart scale', () => {
  it('maps a proportional domain and handles zero span', () => {
    expect(linearScale(5, 0, 10, 20, 580)).toBe(300);
    expect(linearScale(0, 0, 0, 160, 20)).toBe(160);
  });
});
