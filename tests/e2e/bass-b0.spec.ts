import { expect, test } from '@playwright/test';
import {
  centsBetween,
  enableMicrophone,
  expectReading,
  fakeMicrophone,
  noteFrequency,
} from './helpers';
import { TONES } from './tones';

const B0 = noteFrequency(23);

test.use(fakeMicrophone(TONES.b0Harmonics));

test.describe('5-string bass with a low B that has no fundamental', () => {
  test('finds the note from its harmonics alone', async ({ page }) => {
    await page.goto('./');
    await page.getByLabel('Instrument', { exact: true }).selectOption('bass-5');
    await enableMicrophone(page);
    await expectReading(page, {
      note: 'B0',
      cents: centsBetween(TONES.b0Harmonics.frequency, B0), // about -1.9
      hertz: TONES.b0Harmonics.frequency,
      hint: 'In tune',
    });
    await expect(page.getByTestId('string-0').locator('..')).toHaveAttribute('data-tuned', 'true');
  });
});

