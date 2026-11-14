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

test.use(fakeMicrophone(TONES.a2));

test.describe('guitar with an A2 that is in tune', () => {
  test('shows the note, cents and frequency, then checks the string off', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('./');
    await expect(page).toHaveTitle('Pluck Tuner');
    await expect(page.getByTestId('note')).toHaveText('–');

    await enableMicrophone(page);
    await expectReading(page, { note: 'A2', cents: 0, hertz: 110, hint: 'In tune' });
    await expect(page.locator('#gauge')).toHaveAttribute('data-state', 'in-tune');

    // The detected string is highlighted and, after a second in tune, checked.
    const string = page.getByTestId('string-1').locator('..');
    await expect(string).toHaveAttribute('data-active', 'true');
    await expect(string).toHaveAttribute('data-tuned', 'true');
    await expect(page.locator('.string[data-tuned]')).toHaveCount(1);

    // Nothing leaves the device: every request went to the app's own origin.
    const origin = new URL(page.url()).origin;
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
  });

  test('manual mode measures against the selected string only', async ({ page }) => {
    await page.goto('./');
    await enableMicrophone(page);
    await expect(page.getByTestId('note')).toHaveText('A2');

    await page.getByTestId('string-0').click();
    await expect(page.getByRole('button', { name: 'Manual' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectReading(page, {
      note: 'E2',
      cents: Math.round(centsBetween(TONES.a2.frequency, E2)),
      hint: 'Loosen',
    });
    await expect(page.locator('.string[data-tuned]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Auto' }).click();
    await expectReading(page, { note: 'A2', cents: 0, hint: 'In tune' });
  });

  test('pauses detection while a reference tone plays', async ({ page }) => {
    await page.goto('./');
    await enableMicrophone(page);
    await expect(page.getByTestId('note')).toHaveText('A2');

    await page.getByRole('button', { name: 'Play the D3 reference tone' }).click();
    await expect(page.getByTestId('hint')).toHaveText('Playing reference tone');
    await expect(page.getByTestId('note')).toHaveText('–');
    await expect(page.getByTestId('string-2').locator('..')).toHaveAttribute('data-playing', 'true');

    await page.getByRole('button', { name: 'Stop the D3 reference tone' }).click();
    await expectReading(page, { note: 'A2', cents: 0, hint: 'In tune' });
  });

  test('resumes after the page was in the background', async ({ page }) => {
    await page.goto('./');
    await enableMicrophone(page);
    await expect(page.getByTestId('note')).toHaveText('A2');

    const setVisibility = (state: 'hidden' | 'visible') =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => value,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);

    await setVisibility('hidden');
    await expect(page.getByTestId('note')).toHaveText('–');
    await setVisibility('visible');
    await expectReading(page, { note: 'A2', cents: 0, hint: 'In tune' });
    // It came back by itself: no prompt asking for another tap.
    await expect(page.locator('#mic-panel')).toBeHidden();
  });

  test('falls back to an AnalyserNode when AudioWorklet is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      AudioWorklet.prototype.addModule = () => Promise.reject(new Error('disabled for the test'));
    });
    await page.goto('./?debug=1');
    await enableMicrophone(page);
    await expectReading(page, { note: 'A2', cents: 0, hertz: 110, hint: 'In tune' });
    await expect(page.locator('#debug-output')).toContainText('capture=analyser');
  });

  test('shows diagnostics with ?debug=1', async ({ page }) => {
    await page.goto('./?debug=1');
    const output = page.locator('#debug-output');
    await expect(output).toContainText('microphone    : idle');
    await enableMicrophone(page);
    await expect(output).toContainText(/raw frequency : 1(09\.9|10\.0)\d Hz/);
    await expect(output).toContainText(/confidence    : (0\.9\d\d|1\.000)/);
    await expect(output).toContainText(/rms           : -\d+\.\d dBFS/);
    // Whatever rate the machine's audio output runs at: the app must not assume one.
    await expect(output).toContainText(/sample rate   : (44100|48000) Hz/);
    await expect(output).toContainText('capture=worklet');
    await expect(output).toContainText('context=running');
  });
});

