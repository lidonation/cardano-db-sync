import {expect, test} from '@playwright/test';
import {SITE_URL} from '../../playwright.config';

// Plain command controls must explain clipboard failures to sighted users too.
test('plain copy shows translated recovery instructions when the clipboard rejects', async ({
  page,
}) => {
  await page.setViewportSize({width: 320, height: 900});
  await page.goto(test.info().project.use.baseURL ?? SITE_URL);
  await page.locator('#landing-title').waitFor();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard denied');
        },
      },
    });
  });
  const command = page.locator('[data-dbs-component="Command"]').first();
  await command.getByRole('button', {name: 'Copy', exact: true}).click();
  const failed = command.getByRole('button', {
    name: 'Copy failed: select the text instead',
    exact: true,
  });
  await expect(failed).toBeVisible();
  await expect(failed.locator('span')).toHaveText('Copy failed: select the text instead');
  const fits = await failed.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth;
  });
  expect(fits).toBe(true);
  await expect(command.getByRole('status')).toContainText('Copy failed');
});
