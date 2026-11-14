import { type Page, expect } from '@playwright/test';
import type { Tone } from './tones';

/**
 * Browser options that replace the microphone with an audio file. Chrome
 * grants the permission without a prompt and loops the file as the input of
 * a fake capture device.
 */
export function fakeMicrophone(tone: Tone) {
  return {
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${tone.file}`,
      ],
    },
  };
}

export const noteFrequency = (midi: number, a4 = 440): number => a4 * 2 ** ((midi - 69) / 12);
export const centsBetween = (frequency: number, reference: number): number =>
  1200 * Math.log2(frequency / reference);

/** Reads a number such as "+19.4 cents" or "110.0 Hz" off the screen. */
export async function shownNumber(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  return Number.parseFloat(text.replace('−', '-'));
}

/**
 * Waits for the one-time "Ready to work offline" notice of a first visit, so
 * that it cannot show up later and replace the notice a test is waiting for.
 */
export async function waitUntilCached(page: Page): Promise<void> {
  await expect(page.locator('#toast')).toHaveText('Ready to work offline');
}

export async function enableMicrophone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Enable microphone' }).click();
}

/** Waits until the screen shows the given note, deviation and frequency. */
export async function expectReading(
  page: Page,
  expected: { note: string; cents: number; hertz?: number; hint: string },
): Promise<void> {
  await expect(page.getByTestId('note')).toHaveText(expected.note);
  // The readout has one decimal place; allow half a cent around the true value.
  await expect
    .poll(async () => Math.abs((await shownNumber(page, 'cents')) - expected.cents))
    .toBeLessThan(0.5);
  if (expected.hertz !== undefined) {
    const hertz = expected.hertz;
    await expect
      .poll(async () => Math.abs((await shownNumber(page, 'hertz')) - hertz))
      .toBeLessThan(0.06);
  }
  await expect(page.getByTestId('hint')).toHaveText(expected.hint);
}
