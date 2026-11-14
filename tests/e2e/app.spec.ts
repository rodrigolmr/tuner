import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { enableMicrophone, expectReading, fakeMicrophone, waitUntilCached } from './helpers';
import { TONES } from './tones';

test.use(fakeMicrophone(TONES.a2));

/** Saves a screenshot for visual review when SCREENSHOT_DIR is set. */
async function snapshot(page: Page, name: string): Promise<void> {
  const directory = process.env.SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: path.join(directory, `${name}.png`) });
}

test.describe('installable app', () => {
  test('serves a complete web app manifest and its icons', async ({ page, request, baseURL }) => {
    await page.goto('./');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifestUrl = new URL(href!, baseURL).href;
    const manifest = await (await request.get(manifestUrl)).json();

    expect(manifest).toMatchObject({
      name: 'Pluck Tuner',
      short_name: 'Pluck',
      lang: 'en',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/tuner/',
      scope: '/tuner/',
      theme_color: '#0e1014',
      background_color: '#0e1014',
    });

    const described = manifest.icons.map(
      (icon: { sizes: string; purpose: string }) => `${icon.sizes} ${icon.purpose}`,
    );
    expect(described).toEqual(
      expect.arrayContaining(['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable']),
    );
    for (const icon of manifest.icons as Array<{ src: string }>) {
      const response = await request.get(new URL(icon.src, manifestUrl).href);
      expect(response.ok(), icon.src).toBe(true);
      expect(response.headers()['content-type']).toBe('image/png');
    }

    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect(appleIcon).toContain('apple-touch-icon-180.png');
    expect((await request.get(new URL(appleIcon!, baseURL).href)).ok()).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('keeps working without a connection after the first visit', async ({ page, context }) => {
    await page.goto('./');
    // The service worker has finished caching once it is active.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect(page.locator('#toast')).toHaveText('Ready to work offline');

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Pluck' })).toBeVisible();

    // The audio worklet module also has to come from the cache.
    await enableMicrophone(page);
    await expectReading(page, { note: 'A2', cents: 0, hertz: 110, hint: 'In tune' });
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });

  test('shares through a dialog with a QR code and a link to copy', async ({ page, baseURL }) => {
    await page.goto('./');
    await waitUntilCached(page);
    await expect(page.locator('#phone-card')).toBeVisible();
    await expect(page.locator('#phone-qr svg')).toBeVisible();

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share Pluck' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#share-qr svg')).toBeVisible();
    await expect(dialog.locator('#share-url')).toHaveText(baseURL!);
    await snapshot(page, 'desktop-share');

    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.locator('#toast')).toHaveText('Link copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(baseURL);
  });

  test('looks right with a note in tune', async ({ page }) => {
    await page.goto('./');
    await snapshot(page, 'desktop-idle');
    await enableMicrophone(page);
    await expect(page.getByTestId('string-1').locator('..')).toHaveAttribute('data-tuned', 'true');
    await snapshot(page, 'desktop-in-tune');
  });
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  test('opens the system share sheet with the app link', async ({ page, baseURL }) => {
    await page.addInitScript(() => {
      const shared: ShareData[] = [];
      Object.assign(window, { sharedData: shared });
      navigator.share = async (data?: ShareData) => {
        shared.push(data ?? {});
      };
    });
    await page.goto('./');
    await page.getByRole('button', { name: 'Share', exact: true }).tap();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { sharedData: ShareData[] }).sharedData))
      .toEqual([expect.objectContaining({ title: 'Pluck Tuner', url: baseURL })]);
    await expect(page.locator('#share-dialog')).toBeHidden();
  });

  test('copies the link when the Web Share API is missing', async ({ page, baseURL }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
    });
    await page.goto('./');
    await waitUntilCached(page);
    await page.getByRole('button', { name: 'Share', exact: true }).tap();
    await expect(page.locator('#toast')).toHaveText('Link copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(baseURL);
  });

  test('fits the screen for every instrument', async ({ page }) => {
    await page.goto('./');
    await snapshot(page, 'phone-idle');
    const expectedStrings: Record<string, number> = {
      guitar: 6,
      'bass-4': 4,
      'bass-5': 5,
      ukulele: 4,
      cavaquinho: 4,
      mandolin: 4,
      'viola-caipira': 10,
      chromatic: 0,
    };
    for (const [instrument, count] of Object.entries(expectedStrings)) {
      await page.getByLabel('Instrument', { exact: true }).selectOption(instrument);
      await expect(page.locator('.string')).toHaveCount(count);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${instrument} overflows horizontally`).toBeLessThanOrEqual(0);
      await snapshot(page, `phone-${instrument}`);
    }
  });

  test('shows the meter, the tuned check and the settings', async ({ page }) => {
    await page.goto('./');
    await enableMicrophone(page);
    await expect(page.getByTestId('string-1').locator('..')).toHaveAttribute('data-tuned', 'true');
    await snapshot(page, 'phone-in-tune');

    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await snapshot(page, 'phone-settings');
  });
});
