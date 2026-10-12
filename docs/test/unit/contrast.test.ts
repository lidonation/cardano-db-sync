import {afterEach, describe, expect, it, vi} from 'vitest';

import {contrast, paintedBackground} from '../browser/contrast';

afterEach(() => vi.unstubAllGlobals());

describe('browser contrast measurement', () => {
  it('measures black and white at 21:1 and fails invalid colours', () => {
    expect(contrast('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBe(21);
    expect(() => contrast('transparent', 'rgb(0, 0, 0)')).toThrow('Cannot measure');
  });

  it('includes the active link wash over the actual opaque parent', () => {
    const parent = {parentElement: null};
    const child = {parentElement: parent};
    vi.stubGlobal('getComputedStyle', (element: unknown) => ({
      backgroundImage: 'none',
      backgroundColor: element === child ? 'rgba(0, 0, 0, 0.5)' : 'rgb(255, 255, 255)',
    }));
    expect(paintedBackground(child as unknown as Element)).toBe('rgb(127.5, 127.5, 127.5)');
  });

  it('fails a measurement it cannot resolve instead of assuming white', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      backgroundImage: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0)',
    }));
    expect(() => paintedBackground({parentElement: null} as Element)).toThrow('No opaque backdrop');
  });

  it('requires a pixel measurement when a background image is present', () => {
    vi.stubGlobal('getComputedStyle', () => ({backgroundImage: 'linear-gradient(black, white)'}));
    expect(() => paintedBackground({parentElement: null} as Element)).toThrow('pixel measurement');
  });
});
