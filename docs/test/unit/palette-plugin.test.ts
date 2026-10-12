import {describe, expect, it} from 'vitest';

import palettePlugin, {paletteHeadTags} from '../../plugins/palette';
import {PALETTE_BOOTSTRAP} from '../../src/lib/palette';

describe('palette plugin (THM-1)', () => {
  it('is named and injects exactly the palette bootstrap before paint', () => {
    expect(palettePlugin({} as never).name).toBe('dbsync-palette');
    const tags = paletteHeadTags();
    expect(tags.headTags).toHaveLength(1);
    expect(tags.headTags[0].tagName).toBe('script');
    expect(tags.headTags[0].innerHTML).toBe(PALETTE_BOOTSTRAP);
  });

  it('exposes the injection through the plugin hook', () => {
    const plugin = palettePlugin({} as never);
    expect(plugin.injectHtmlTags).toBe(paletteHeadTags);
  });
});
