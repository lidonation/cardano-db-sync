import {expect, test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('installation methods support roving keyboard focus and activate panels', async ({page}) => {
  await page.goto('docs/guides/installation/');
  const list = page.getByRole('tablist', {name: 'Procedure options'});
  const docker = list.getByRole('tab', {name: 'Docker'});
  const nix = list.getByRole('tab', {name: 'nix'});
  const cabal = list.getByRole('tab', {name: 'cabal'});
  await expect(docker).toHaveAttribute('aria-selected', 'true');
  await docker.focus();
  await page.keyboard.press('ArrowRight');
  await expect(nix).toBeFocused();
  await expect(nix).toHaveAttribute('aria-selected', 'true');
  await expect(docker).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('End');
  await expect(cabal).toBeFocused();
  await expect(cabal).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel', {name: 'cabal'});
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('cabal build');
});

for (const palette of ['light', 'dark', 'cream', 'navy']) {
  test(`guide alert remains visible in ${palette}`, async ({page}) => {
    await page.addInitScript((value) => {
      localStorage.setItem('dbs-palette', value);
      localStorage.setItem('theme', value === 'dark' || value === 'navy' ? 'dark' : 'light');
    }, palette);
    await page.goto('docs/guides/installation/');
    const note = page.getByRole('complementary', {name: 'NOTE'});
    await expect(note).toBeVisible();
    await expect(note).toContainText('confirm release compatibility', {ignoreCase: true});
    expect(await note.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
  });
}

test('guide code blocks obey the site CSP before and after highlighting', async ({page}) => {
  await page.goto('docs/guides/installation/');
  await expect(page.locator('main pre code .token').first()).toBeAttached();
  await expect(
    page.locator('main .theme-code-block[style], main .theme-code-block [style]'),
  ).toHaveCount(0);
});

test('links in guide prose remain distinguishable without relying on color', async ({page}) => {
  await page.goto('docs/intro/');
  const link = page.getByRole('link', {name: 'installation guide', exact: true});
  await expect(link).toHaveCSS('text-decoration-line', /underline/);
});

for (const guide of [
  'installation',
  'first-queries',
  'kubernetes',
  'monitoring-rollback',
  'pool-metadata',
  'restore-from-snapshot',
  'smash-operations',
  'trimming',
  'ubuntu-systemd',
  'running',
  'installing-with-nix',
  'building-running',
  'database-encode-decode',
  'docker',
  'installing',
  'interesting-queries',
  'manual-rollbacks',
  'migrations',
  'schema-management',
  'state-snapshot',
  'troubleshooting',
  'upgrading-postgresql',
  'validation',
]) {
  test(`${guide} guide has no WCAG A/AA violations`, async ({page}) => {
    await page.goto(`docs/guides/${guide}/`);
    const result = await new AxeBuilder({page})
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  });
}
