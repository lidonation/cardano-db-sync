import {expect, test} from '@playwright/test';

import {LOCALES} from '../../config/i18n';

for (const locale of LOCALES) {
  test(`Numbers ${locale} uses English fallback for incomplete translations`, async ({page}) => {
    await page.goto(`${locale === 'en' ? '' : `${locale}/`}numbers/`);
    const main = page.getByRole('main');
    await expect(main).toContainText(/unavailable/i);
    await expect(main).not.toContainText(/0 GB|\$0|healthy|sync time/i);
    await expect(main.getByRole('table')).toHaveCount(0);
    // English inherits html[lang=en]; incomplete non-English pages need an explicit marker.
    await expect(main).toHaveJSProperty('lang', locale === 'en' ? '' : 'en');
    if (locale === 'en') await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
}
