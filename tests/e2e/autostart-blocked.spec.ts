import { expect, test } from '@playwright/test';
import { enableMicrophone, expectReading, fakeMicrophone } from './helpers';
import { TONES } from './tones';

test.use({
  // The microphone was allowed on an earlier visit, but audio needs a tap to
  // start, as in an ordinary browser tab.
  ...fakeMicrophone(TONES.a2, ['--autoplay-policy=document-user-activation-required']),
  permissions: ['microphone'],
});

test.describe('coming back where audio cannot start by itself', () => {
  test('leaves the microphone closed and keeps the button', async ({ page }) => {
    await page.goto('./?debug=1');
    const output = page.locator('#debug-output');
    // Longer than the app waits for the audio clock to start.
    await page.waitForTimeout(2000);
    await expect(output).toContainText('microphone    : idle');
    await expect(output).toContainText('track         : none');

    await enableMicrophone(page);
    await expectReading(page, { note: 'A2', cents: 0, hertz: 110, hint: 'In tune' });
  });
});
