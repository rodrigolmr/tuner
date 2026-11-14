import { expect, test } from '@playwright/test';
import { expectReading, fakeMicrophone } from './helpers';
import { TONES } from './tones';

test.use({
  // Audio may start without a tap, as Chrome allows for an installed app...
  ...fakeMicrophone(TONES.a2, ['--autoplay-policy=no-user-gesture-required']),
  // ...and the microphone was allowed on an earlier visit.
  permissions: ['microphone'],
});

test.describe('coming back with the microphone already allowed', () => {
  test('starts listening without a tap', async ({ page }) => {
    await page.goto('./?debug=1');
    await expectReading(page, { note: 'A2', cents: 0, hertz: 110, hint: 'In tune' });
    await expect(page.locator('#mic-panel')).toBeHidden();
    await expect(page.locator('#debug-output')).toContainText('microphone    : running');
  });

  test('waits for the page to be shown when it loads in the background', async ({ page }) => {
    await page.addInitScript(() => {
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.assign(window, {
        showPage: () => {
          state = 'visible';
          document.dispatchEvent(new Event('visibilitychange'));
        },
      });
    });
    await page.goto('./?debug=1');
    const output = page.locator('#debug-output');
    await expect(output).toContainText('microphone    : idle');
    // Long enough for the microphone to have been opened, had the app tried.
    await page.waitForTimeout(1000);
    await expect(output).toContainText('track         : none');

    await page.evaluate(() => (window as unknown as { showPage: () => void }).showPage());
    await expectReading(page, { note: 'A2', cents: 0, hint: 'In tune' });
  });
});
