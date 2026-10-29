import {expect, test} from '@playwright/test';

for (const width of [375, 768, 1024, 1280, 1440]) {
  test(`header and footer reach Guides at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await page.goto('./');
    const header = page.locator('header[data-dbs-component="Navbar / Full"]');
    const menu = header.getByRole('button', {name: 'Menu'});
    if (width < 1280) await menu.click();
    const sections = header.getByRole('navigation', {name: 'Sections'}).filter({visible: true});
    const guides = sections.getByRole('link', {name: 'Guides', exact: true});
    await expect(guides).toBeVisible();
    await expect(guides).toHaveAttribute('href', /\/docs\/guides\/?$/);
    const footer = page.getByRole('contentinfo').getByRole('navigation', {name: 'Footer'});
    await expect(footer.getByRole('link', {name: 'Guides', exact: true})).toHaveAttribute(
      'href',
      /\/docs\/guides\/?$/,
    );
    await expect(footer.getByRole('link', {name: 'Installation', exact: true})).toHaveAttribute(
      'href',
      /\/docs\/guides\/installation\/?$/,
    );
    await guides.click();
    await expect(page.getByRole('heading', {name: 'Guides', level: 1})).toBeVisible();
    await expect(page.locator('main article .markdown a[href*="/docs/guides/"]')).toHaveCount(23);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}

test('only Guides is current in the header while reading a guide', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('docs/guides/running/');
  const sections = page
    .locator('header[data-dbs-component="Navbar / Full"]')
    .getByRole('navigation', {name: 'Sections'})
    .filter({visible: true});
  await expect(sections.getByRole('link', {name: 'Guides', exact: true})).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sections.getByRole('link', {name: 'Docs', exact: true})).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});
