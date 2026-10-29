import {expect, test} from '@playwright/test';

for (const guide of ['installation', 'kubernetes', 'ubuntu-systemd']) {
  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`${guide} heading follows the design type scale at ${width}px`, async ({
      page,
      baseURL,
    }) => {
      await page.setViewportSize({width, height: 900});
      await page.goto(`${new URL(baseURL!).pathname}docs/guides/${guide}`);
      const heading = page.locator('main article .markdown h1').first();
      await expect(heading).toBeVisible();
      await expect(heading).toHaveCSS('font-size', '38px');
      await expect(heading).toHaveCSS('font-weight', '700');
      await expect(heading).toHaveCSS('font-family', /Space Grotesk/);
      await expect(heading).toHaveCSS('line-height', '45.6px');
      await expect(heading).toHaveCSS('letter-spacing', '-0.76px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}

test('client navigation preserves the designed heading on a static guide', async ({
  page,
  baseURL,
}) => {
  const base = new URL(baseURL!).pathname;
  await page.goto(`${base}docs/guides/`);
  await page
    .getByRole('link', {name: /Running on Kubernetes/})
    .first()
    .click();
  const heading = page.locator('main article .markdown h1').first();
  await expect(heading).toHaveText('Running on Kubernetes');
  await expect(heading).toHaveCSS('font-size', '38px');
  await expect(heading).toHaveCSS('font-family', /Space Grotesk/);
});

for (const locale of ['ja', 'es', 'de', 'vi']) {
  test(`guide headings retain the type token in ${locale}`, async ({page, baseURL}) => {
    const base = new URL(baseURL!).pathname;
    await page.setViewportSize({width: 375, height: 900});
    await page.goto(`${base}${locale}/docs/guides/kubernetes`);
    const heading = page.locator('main article .markdown h1').first();
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS('font-size', '38px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
