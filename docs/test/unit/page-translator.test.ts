import {describe, expect, it, vi} from 'vitest';

import {pageTranslator} from '../../src/i18n/pageTranslator';

describe('page language fallback', () => {
  it('renders the entire English page when a translation is partial', () => {
    const localize = vi.fn(() => '部分');
    const translate = pageTranslator(['one', 'two'], {one: '部分'}, 'ja', 'en', localize);
    expect(translate({id: 'one', message: 'One'})).toBe('One');
    expect(translate({id: 'two', message: 'Two'})).toBe('Two');
    expect(localize).not.toHaveBeenCalled();
  });
  it.each(['en', 'ja'])('uses Docusaurus for the complete %s page', (locale) => {
    const localize = vi.fn(() => 'localized');
    expect(
      pageTranslator(
        ['one'],
        {one: 'translated'},
        locale,
        'en',
        localize,
      )({id: 'one', message: 'One'}),
    ).toBe('localized');
    expect(localize).toHaveBeenCalledOnce();
  });
});
