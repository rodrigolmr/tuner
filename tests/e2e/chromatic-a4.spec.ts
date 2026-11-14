import { expect, test } from '@playwright/test';
import { centsBetween, enableMicrophone, expectReading, fakeMicrophone } from './helpers';
import { TONES } from './tones';

test.use(fakeMicrophone(TONES.a4));

test.describe('chromatic mode with an A4', () => {
  test('follows the calibration and the note naming, and remembers them', async ({ page }) => {
    await page.goto('./');
    await page.getByLabel('Instrument', { exact: true }).selectOption('chromatic');
    await expect(page.locator('#strings')).toBeHidden();
    await enableMicrophone(page);
    await expectReading(page, { note: 'A4', cents: 0, hertz: 440, hint: 'In tune' });

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Raise reference pitch' }).click();
    await page.getByRole('button', { name: 'Raise reference pitch' }).click();
    await expect(page.locator('#a4-value')).toHaveText('442 Hz');
    await page.getByRole('button', { name: 'Do Re Mi' }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();

    const flat = centsBetween(440, 442); // about -7.9
    await expectReading(page, { note: 'La4', cents: flat, hint: 'Tighten' });
    await expect(page.locator('#gauge')).toHaveAttribute('data-state', 'flat');

    await page.reload();
    await expect(page.getByLabel('Instrument', { exact: true })).toHaveValue('chromatic');
    await enableMicrophone(page);
    await expectReading(page, { note: 'La4', cents: flat, hint: 'Tighten' });
  });
});

