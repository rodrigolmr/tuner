import { expect, test } from '@playwright/test';
import {
  centsBetween,
  enableMicrophone,
  expectReading,
  fakeMicrophone,
  noteFrequency,
} from './helpers';
import { TONES } from './tones';

const E2 = noteFrequency(40);

test.use(fakeMicrophone(TONES.e2Sharp));

test.describe('guitar with a sharp E2', () => {
  test('shows how many cents the string is off and which way to turn', async ({ page }) => {
    await page.goto('./');
    await enableMicrophone(page);
    await expectReading(page, {
      note: 'E2',
      cents: centsBetween(TONES.e2Sharp.frequency, E2), // about +19.4
      hertz: TONES.e2Sharp.frequency,
      hint: 'Loosen',
    });
    await expect(page.locator('#gauge')).toHaveAttribute('data-state', 'sharp');
    const string = page.getByTestId('string-0').locator('..');
    await expect(string).toHaveAttribute('data-active', 'true');
    // Out of tolerance: it must never be checked off.
    await page.waitForTimeout(1500);
    await expect(page.locator('.string[data-tuned]')).toHaveCount(0);
  });
});

