import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';

/**
 * Layout checks that need no microphone, so they run in Chrome, Firefox and
 * WebKit (the engine of Safari) alike. The sizes are those of phone screens,
 * set as plain viewports: Firefox has no mobile emulation.
 */
test.use({ serviceWorkers: 'block' });

const PHONE = { width: 412, height: 915 };
const SMALL_PHONE = { width: 360, height: 640 };
/** A screen so short that the dial has to give up some of its width. */
const SHORT_PHONE = { width: 375, height: 600 };

/** Width to height of the dial drawing (its viewBox is 320 by 182). */
const DIAL_RATIO = 320 / 182;
/** Radius left free inside the ring of bars, as a share of the dial's width. */
const INNER_RADIUS = 121 / 320;
/** Distance from the top of the dial to the centre the ring is drawn around. */
const CENTRE_Y = 164 / 182;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

async function box(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).first().evaluate((element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  });
}

const centreX = (rect: Box): number => (rect.left + rect.right) / 2;

function expectInside(inner: Box, outer: Box, what: string): void {
  expect(inner.left, `${what}: left edge`).toBeGreaterThanOrEqual(outer.left - 0.5);
  expect(inner.right, `${what}: right edge`).toBeLessThanOrEqual(outer.right + 0.5);
  expect(inner.top, `${what}: top edge`).toBeGreaterThanOrEqual(outer.top - 0.5);
  expect(inner.bottom, `${what}: bottom edge`).toBeLessThanOrEqual(outer.bottom + 0.5);
}

/** How far the page is larger than the screen, sideways and downwards. */
async function overflow(page: Page): Promise<{ sideways: number; downwards: number }> {
  return page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth - window.innerWidth,
    downwards: document.documentElement.scrollHeight - window.innerHeight,
  }));
}

/** Saves a screenshot per browser for visual review when SCREENSHOT_DIR is set. */
async function snapshot(page: Page, name: string): Promise<void> {
  const directory = process.env.SCREENSHOT_DIR;
  if (!directory) return;
  const browser = test.info().project.name;
  await page.screenshot({ path: path.join(directory, `layout-${browser}-${name}.png`) });
}

interface Reading {
  state: 'flat' | 'sharp' | 'in-tune';
  name: string;
  accidental: string;
  octave: string;
  hint: string;
}

/**
 * Puts the screen in the state it has while a note sounds. The app only
 * redraws when something changes, and with the microphone off nothing does,
 * so what is written here stays on screen.
 */
async function showReading(page: Page, reading: Reading): Promise<void> {
  await page.evaluate((shown) => {
    const byId = (id: string): HTMLElement => document.getElementById(id)!;
    byId('app').dataset.mic = 'running';
    byId('gauge').dataset.state = shown.state;
    const note = byId('note');
    note.removeAttribute('data-empty');
    note.dataset.length = String(shown.name.length);
    byId('note-name').textContent = shown.name;
    byId('note-accidental').textContent = shown.accidental;
    byId('note-octave').textContent = shown.octave;
    byId('hint').textContent = shown.hint;
    byId('cents').textContent = '+19.3 cents';
    byId('hertz').textContent = '83.33 Hz';
  }, reading);
}

async function expectDialDrawn(page: Page): Promise<Box> {
  const meter = await box(page, '.meter');
  expect(meter.width, 'the dial has a usable size').toBeGreaterThan(200);
  expect(meter.width / meter.height, 'the dial keeps its proportions').toBeCloseTo(DIAL_RATIO, 1);
  const drawing = await box(page, '#dial');
  expect(drawing.width, 'the drawing fills its box').toBeCloseTo(meter.width, 0);
  expect(drawing.height, 'the drawing fills its box').toBeCloseTo(meter.height, 0);
  expectInside(meter, await box(page, '#gauge'), 'dial inside its card');
  return meter;
}

for (const [name, viewport] of Object.entries({ PHONE, SMALL_PHONE, SHORT_PHONE })) {
  test.describe(`on a ${viewport.width} by ${viewport.height} screen`, () => {
    test.use({ viewport });

    test('everything fits before the microphone is on', async ({ page }) => {
      await page.goto('./');
      await expect(page.locator('.dial-segment')).toHaveCount(51);
      expect(await overflow(page)).toEqual({ sideways: 0, downwards: 0 });

      const meter = await expectDialDrawn(page);
      // The microphone button stands in the middle of the dial, where the note will be.
      const button = page.getByRole('button', { name: 'Enable microphone' });
      await expect(button).toBeVisible();
      const buttonBox = await box(page, '#mic-button');
      expectInside(buttonBox, meter, 'microphone button inside the dial');
      expect(Math.abs(centreX(buttonBox) - centreX(meter))).toBeLessThan(1.5);
      await expect(page.locator('#note')).toBeHidden();
      await expect(page.locator('.privacy')).toBeVisible();
      expectInside(await box(page, '.privacy'), await box(page, '#gauge'), 'privacy note');

      // Six strings in one row, all the same size and big enough to tap.
      await expect(page.locator('.string')).toHaveCount(6);
      const card = await box(page, '#strings-section');
      const first = await box(page, '.string');
      expect(first.width).toBeGreaterThanOrEqual(40);
      for (let index = 0; index < 6; index++) {
        const string = await box(page, `.string:nth-child(${index + 1})`);
        expectInside(string, card, `string ${index}`);
        expect(string.top).toBeCloseTo(first.top, 0);
        expect(string.width).toBeCloseTo(first.width, 0);
      }
      await expect(page.locator('#tuned-count')).toHaveText('0 of 6 in tune');
      await snapshot(page, `${name}-microphone-off`);
    });

    test('the note sits inside the dial while tuning', async ({ page }) => {
      await page.goto('./');
      await showReading(page, { state: 'sharp', name: 'E', accidental: '', octave: '2', hint: 'Loosen' });
      expect(await overflow(page)).toEqual({ sideways: 0, downwards: 0 });

      const meter = await expectDialDrawn(page);
      await expect(page.locator('#mic-panel')).toBeHidden();
      await expect(page.locator('.privacy')).toBeHidden();
      await expect(page.locator('#note')).toBeVisible();

      // The letter is sized from the dial and centred under the notch.
      const fontSize = await page
        .locator('#note')
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(fontSize).toBeGreaterThan(0.29 * meter.width);
      expect(fontSize).toBeLessThan(0.31 * meter.width);
      const letter = await box(page, '#note-name');
      expect(Math.abs(centreX(letter) - centreX(meter))).toBeLessThan(1.5);

      // Its top corners stay clear of the ring of bars around it.
      const centreY = meter.top + CENTRE_Y * meter.height;
      const corner = Math.hypot(letter.width / 2, centreY - letter.top);
      expect(corner).toBeLessThan(INNER_RADIUS * meter.width);
      expect(letter.bottom).toBeLessThanOrEqual(meter.bottom + 1);

      // The advice and the numbers follow below the dial, inside the card.
      const card = await box(page, '#gauge');
      const hint = await box(page, '#hint');
      expect(hint.top).toBeGreaterThanOrEqual(meter.bottom - 1);
      expectInside(hint, card, 'hint');
      const numbers = await box(page, '.numbers');
      expect(numbers.top).toBeGreaterThanOrEqual(hint.bottom - 1);
      expectInside(numbers, card, 'numbers');
      await snapshot(page, `${name}-tuning`);
    });
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('a short screen makes the dial narrower instead of pushing the strings away', async ({
    page,
  }) => {
    await page.setViewportSize(SHORT_PHONE);
    await page.goto('./');
    const meter = await expectDialDrawn(page);
    const slot = await box(page, '.meter-slot');
    // The height is what limits it here, so it does not use the whole width.
    expect(meter.width).toBeLessThan(slot.width - 5);
    expect(meter.height).toBeCloseTo(slot.height, 0);
    expect((await box(page, '#strings-section')).bottom).toBeLessThanOrEqual(SHORT_PHONE.height);

    // With room to spare the dial is as wide as its slot.
    await page.setViewportSize(PHONE);
    const tall = await expectDialDrawn(page);
    expect(tall.width).toBeCloseTo((await box(page, '.meter-slot')).width, 0);
  });

  test('long note names get smaller type', async ({ page }) => {
    await page.goto('./');
    await showReading(page, { state: 'in-tune', name: 'Sol', accidental: '♯', octave: '4', hint: 'In tune' });
    const meter = await expectDialDrawn(page);
    const fontSize = await page
      .locator('#note')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThan(0.19 * meter.width);
    expect(fontSize).toBeLessThan(0.21 * meter.width);
    // The accidental and the octave hang to the right of the name, still inside the dial.
    const marks = await box(page, '.note-marks');
    const name = await box(page, '#note-name');
    expect(marks.left).toBeGreaterThanOrEqual(name.right - 1);
    expect(marks.right).toBeLessThan(meter.right);
    const centreY = meter.top + CENTRE_Y * meter.height;
    expect(Math.hypot(marks.right - centreX(meter), centreY - marks.top)).toBeLessThan(
      INNER_RADIUS * meter.width,
    );
    await snapshot(page, 'solfege-in-tune');
  });

  test('every instrument fits the screen', async ({ page }) => {
    await page.goto('./');
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
      expect(await overflow(page), instrument).toEqual({ sideways: 0, downwards: 0 });
      await expectDialDrawn(page);
      if (count > 0) {
        const card = await box(page, '#strings-section');
        expectInside(await box(page, '.string:last-child'), card, `${instrument}: last string`);
      }
    }
    // The viola caipira stacks the two strings of each pair.
    await page.getByLabel('Instrument', { exact: true }).selectOption('viola-caipira');
    const low = await box(page, '.string:nth-child(1)');
    const high = await box(page, '.string:nth-child(2)');
    expect(high.left).toBeCloseTo(low.left, 0);
    expect(high.top).toBeGreaterThan(low.bottom);
    await snapshot(page, 'viola-caipira');
  });

  test('a string shows that it is being held in tune', async ({ page }) => {
    await page.goto('./');
    await showReading(page, { state: 'in-tune', name: 'A', accidental: '', octave: '2', hint: 'In tune' });
    const before = await box(page, '.string:nth-child(2)');
    await page.locator('.string:nth-child(2)').evaluate((element) => {
      const string = element as HTMLElement;
      string.dataset.active = 'true';
      string.dataset.inTune = 'true';
      string.style.setProperty('--progress', '0.6');
    });
    await page.locator('.string:nth-child(3)').evaluate((element) => {
      (element as HTMLElement).dataset.tuned = 'true';
    });
    // The ring is drawn over the border: the card itself does not move or grow.
    expect(await box(page, '.string:nth-child(2)')).toEqual(before);
    const ring = await page.locator('.string:nth-child(2)').evaluate((element) => {
      const style = getComputedStyle(element, '::after');
      return { content: style.content, opacity: style.opacity };
    });
    expect(ring.content).not.toBe('none');
    expect(ring.opacity).toBe('1');
    await expect(page.locator('.string:nth-child(3) .string-check')).toBeVisible();
    await snapshot(page, 'strings-held');
  });

  test('the settings open as a sheet within the screen', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    // Let the sheet finish sliding up.
    await expect
      .poll(async () => Math.round((await box(page, '#settings-dialog')).bottom))
      .toBe(PHONE.height);
    const sheet = await box(page, '#settings-dialog');
    expect(sheet.left).toBeGreaterThanOrEqual(0);
    expect(sheet.right).toBeLessThanOrEqual(PHONE.width);
    expect(sheet.top).toBeGreaterThanOrEqual(0);
    await expect(dialog.getByRole('button', { name: 'Do Re Mi' })).toBeVisible();
    await snapshot(page, 'settings');

    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await expect(dialog).toBeHidden();
  });
});
