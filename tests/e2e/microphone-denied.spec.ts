import { expect, test } from '@playwright/test';
import { enableMicrophone } from './helpers';

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream=deny',
      // A machine without any microphone (a CI runner) would report "no
      // microphone found" before the permission is even asked for.
      '--use-fake-device-for-media-stream',
    ],
  },
});

test.describe('when the microphone is refused', () => {
  test('explains how to allow it', async ({ page }) => {
    await page.goto('./');
    await enableMicrophone(page);
    await expect(page.locator('#mic-message')).toContainText('Microphone access was blocked');
    await expect(page.getByRole('button', { name: 'Enable microphone' })).toBeEnabled();
  });
});
