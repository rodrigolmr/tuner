import { describe, expect, it } from 'vitest';
import { midiToFrequency, parseNote } from '../../src/music/notes';
import { findInstrument, findTuning } from '../../src/music/tunings';
import { TunerSession } from '../../src/ui/session';
import { sanitizeSettings } from '../../src/ui/settings';

const strings = (instrument: string, tuning: string) =>
  findTuning(findInstrument(instrument), tuning)!.strings;
const hz = (note: string, cents = 0, a4 = 440) =>
  midiToFrequency(parseNote(note), a4) * 2 ** (cents / 1200);

function guitar(mode: 'auto' | 'manual' = 'auto'): TunerSession {
  return new TunerSession({
    strings: strings('guitar', 'standard'),
    mode,
    a4: 440,
    toleranceCents: 3,
  });
}

/** Holds a pitch for a while, with one reading every 20 ms, and returns the last view. */
function hold(session: TunerSession, frequency: number | null, fromMs: number, durationMs: number) {
  let view = session.view;
  for (let time = fromMs; time <= fromMs + durationMs; time += 20) {
    view = session.update(frequency, time);
  }
  return view;
}

describe('TunerSession in automatic mode', () => {
  it('shows nothing until a note sounds', () => {
    const session = guitar();
    expect(session.view).toMatchObject({ active: false, targetMidi: null, stringIndex: null });
    expect(session.update(null, 0).active).toBe(false);
  });

  it('measures against the nearest string', () => {
    const session = guitar();
    const view = hold(session, hz('A2', -20), 0, 600);
    expect(view).toMatchObject({ active: true, stringIndex: 1, targetMidi: parseNote('A2') });
    expect(view.cents).toBeCloseTo(-20, 6);
    expect(view.direction).toBe('flat');
    expect(hold(session, hz('A2', 12), 1000, 600).direction).toBe('sharp');
    expect(hold(session, hz('A2', 2), 2000, 600).direction).toBe('in-tune');
  });

  it('smooths the cents instead of jumping', () => {
    const session = guitar();
    hold(session, hz('A2', 0), 0, 400);
    const first = session.update(hz('A2', 30), 420);
    expect(first.cents!).toBeGreaterThan(2);
    expect(first.cents!).toBeLessThan(10);
    expect(hold(session, hz('A2', 30), 440, 800).cents).toBeCloseTo(30, 1);
  });

  it('checks a string off after one second in tune', () => {
    const session = guitar();
    const tunedEvents: number[] = [];
    session.onTuned = (index) => tunedEvents.push(index);

    expect(hold(session, hz('D3', 1.5), 0, 900).tuned[2]).toBe(false);
    expect(hold(session, hz('D3', 1.5), 920, 200).tuned[2]).toBe(true);
    expect(tunedEvents).toEqual([2]);
    expect(session.view.tuned).toEqual([false, false, true, false, false, false]);
  });

  it('reports how far along the hold is', () => {
    const session = guitar();
    expect(session.view.holdProgress).toBe(0);
    // Out of tune: nothing is counted.
    expect(hold(session, hz('G3', 20), 0, 400).holdProgress).toBe(0);
    hold(session, null, 420, 100);

    expect(hold(session, hz('D3', 1), 1000, 500).holdProgress).toBeCloseTo(0.5, 6);
    expect(hold(session, hz('D3', 1), 1520, 600).holdProgress).toBe(1);

    // Silence shows nothing; the check brings the next pluck straight to the end.
    expect(hold(session, null, 2140, 200).holdProgress).toBe(0);
    expect(session.update(hz('D3', 1), 2400).holdProgress).toBe(1);
    // Another string starts from the beginning.
    expect(session.update(hz('E4', 1), 2420).holdProgress).toBeLessThan(0.05);
  });

  it('shows the new check to whoever listens for it', () => {
    const session = guitar();
    const seen: boolean[][] = [];
    session.onTuned = () => seen.push([...session.view.tuned]);
    hold(session, hz('D3'), 0, 1200);
    expect(seen).toEqual([[false, false, true, false, false, false]]);
  });

  it('keeps counting from one pluck of a string to the next', () => {
    const session = guitar();
    // Two short notes, as on a string that does not sustain.
    expect(hold(session, hz('D3', 1), 0, 600).tuned[2]).toBe(false);
    hold(session, null, 620, 300);
    expect(hold(session, hz('D3', 1), 940, 300).tuned[2]).toBe(false);
    expect(hold(session, hz('D3', 1), 1260, 200).tuned[2]).toBe(true);
  });

  it('does not let the sharp attack of a pluck undo the count', () => {
    const session = guitar();
    hold(session, hz('D3', 1), 0, 500);
    hold(session, null, 520, 300);
    hold(session, hz('D3', 9), 840, 200);
    expect(hold(session, hz('D3', 1), 1060, 800).tuned[2]).toBe(true);
  });

  it('starts over when the string stays out of tune', () => {
    const session = guitar();
    hold(session, hz('D3', 1), 0, 700);
    hold(session, hz('D3', 9), 720, 800);
    expect(hold(session, hz('D3', 1), 1540, 700).tuned[2]).toBe(false);
    expect(hold(session, hz('D3', 1), 2260, 600).tuned[2]).toBe(true);
  });

  it('starts over when another string is played', () => {
    const session = guitar();
    hold(session, hz('D3'), 0, 700);
    hold(session, hz('G3'), 720, 300);
    expect(hold(session, hz('D3'), 1040, 700).tuned[2]).toBe(false);
  });

  it('takes the check away when the string goes out of tune', () => {
    const session = guitar();
    const tunedEvents: number[] = [];
    session.onTuned = (index) => tunedEvents.push(index);
    hold(session, hz('D3'), 0, 1200);

    // A short excursion is not enough...
    expect(hold(session, hz('D3', -10), 1220, 300).tuned[2]).toBe(true);
    // ...but a string that stays flat is no longer in tune.
    const flat = hold(session, hz('D3', -10), 1540, 500);
    expect(flat.direction).toBe('flat');
    expect(flat.tuned[2]).toBe(false);

    expect(hold(session, hz('D3'), 2060, 1400).tuned[2]).toBe(true);
    expect(tunedEvents).toEqual([2, 2]);
  });

  it('keeps the check while other notes are played', () => {
    const session = guitar();
    hold(session, hz('D3'), 0, 1200);
    // A fretted note next to the open string, then a melody on other strings.
    hold(session, hz('D#3'), 1220, 2000);
    hold(session, hz('F3', 20), 3240, 2000);
    expect(session.view.tuned).toEqual([false, false, true, false, false, false]);
  });

  it('clears the checks when the tuning or the calibration changes', () => {
    const session = guitar();
    hold(session, hz('D3'), 0, 1200);
    expect(session.view.tuned[2]).toBe(true);
    session.setStrings(strings('guitar', 'drop-d'));
    expect(session.view.tuned).toEqual([false, false, false, false, false, false]);

    hold(session, hz('D3'), 2000, 1200);
    expect(session.view.tuned[2]).toBe(true);
    session.setA4(442);
    expect(session.view.tuned.some(Boolean)).toBe(false);
  });

  it('respects the A4 calibration', () => {
    const session = new TunerSession({
      strings: strings('guitar', 'standard'),
      mode: 'auto',
      a4: 432,
      toleranceCents: 3,
    });
    expect(hold(session, hz('A2', 0, 432), 0, 400).cents).toBeCloseTo(0, 6);
    expect(hold(session, hz('A2', 0, 440), 1000, 800).cents).toBeCloseTo(
      1200 * Math.log2(440 / 432),
      1,
    );
  });

  it('checks unison strings off one note at a time', () => {
    const session = new TunerSession({
      strings: strings('viola-caipira', 'cebolao-d'), // A3 at 1, 6 and 7
      mode: 'auto',
      a4: 440,
      toleranceCents: 3,
    });
    // One long note checks off a single string.
    const first = hold(session, hz('A3'), 0, 3000);
    expect(first.stringIndex).toBe(1);
    expect(first.tuned.filter(Boolean)).toHaveLength(1);

    hold(session, null, 3020, 200);
    const second = hold(session, hz('A3'), 3240, 1200);
    expect(second.stringIndex).toBe(6);
    expect(second.tuned[6]).toBe(true);

    hold(session, null, 4460, 200);
    expect(hold(session, hz('A3'), 4680, 1200).stringIndex).toBe(7);
    // The low octave of the pair is a different string.
    hold(session, null, 5900, 200);
    expect(hold(session, hz('A2'), 6120, 400).stringIndex).toBe(0);
  });
});

describe('TunerSession in manual mode', () => {
  it('shows the selected string even before a note sounds', () => {
    const session = guitar('manual');
    session.selectString(4);
    expect(session.view).toMatchObject({
      active: false,
      stringIndex: 4,
      targetMidi: parseNote('B3'),
    });
  });

  it('measures only against the selected string', () => {
    const session = guitar('manual');
    session.selectString(0);
    const view = hold(session, hz('A2'), 0, 800);
    expect(view.stringIndex).toBe(0);
    expect(view.targetMidi).toBe(parseNote('E2'));
    expect(view.cents).toBeCloseTo(500, 0);
    expect(view.direction).toBe('sharp');

    // An octave below the target reads as very flat, never as in tune.
    const low = hold(session, hz('E1'), 1000, 800);
    expect(low.cents).toBeCloseTo(-1200, 0);
    expect(low.direction).toBe('flat');
    expect(low.tuned[0]).toBe(false);
  });

  it('checks off the selected string', () => {
    const session = guitar('manual');
    session.selectString(5);
    expect(hold(session, hz('E4', -2), 0, 1200).tuned).toEqual(
      [false, false, false, false, false, true],
    );
  });

  it('keeps the check when another string is played by mistake', () => {
    const session = guitar('manual');
    session.selectString(5);
    hold(session, hz('E4'), 0, 1200);
    expect(hold(session, hz('B3'), 1220, 2000).tuned[5]).toBe(true);
  });
});

describe('TunerSession in chromatic mode', () => {
  const chromatic = () =>
    new TunerSession({ strings: [], mode: 'auto', a4: 440, toleranceCents: 3 });

  it('measures against the nearest note', () => {
    const session = chromatic();
    const view = hold(session, 440 * 2 ** (19 / 1200), 0, 600);
    expect(view).toMatchObject({ targetMidi: 69, stringIndex: null, direction: 'sharp' });
    expect(view.cents).toBeCloseTo(19, 6);
    expect(view.tuned).toEqual([]);
  });

  it('keeps the note slightly past the halfway point, then moves on', () => {
    const session = chromatic();
    hold(session, 440, 0, 200);
    expect(hold(session, 440 * 2 ** (55 / 1200), 220, 200).targetMidi).toBe(69);
    expect(hold(session, 440 * 2 ** (70 / 1200), 440, 200).targetMidi).toBe(70);
  });
});

describe('sanitizeSettings', () => {
  it('returns the defaults for missing or broken data', () => {
    for (const stored of [null, undefined, 'x', 42, [], {}]) {
      expect(sanitizeSettings(stored)).toEqual({
        a4: 440,
        notation: 'letters',
        accidental: 'sharp',
        toleranceCents: 3,
        sensitivity: 3,
        instrumentId: 'guitar',
        tuningIds: {},
        mode: 'auto',
      });
    }
  });

  it('keeps valid values and clamps the rest', () => {
    const settings = sanitizeSettings({
      a4: 457,
      notation: 'solfege',
      accidental: 'flat',
      toleranceCents: 0,
      sensitivity: 4.4,
      instrumentId: 'viola-caipira',
      tuningIds: { 'viola-caipira': 'rio-abaixo', guitar: 'nope', kazoo: 'standard' },
      mode: 'manual',
    });
    expect(settings).toEqual({
      a4: 450,
      notation: 'solfege',
      accidental: 'flat',
      toleranceCents: 1,
      sensitivity: 4,
      instrumentId: 'viola-caipira',
      tuningIds: { 'viola-caipira': 'rio-abaixo' },
      mode: 'manual',
    });
    expect(sanitizeSettings({ a4: 'loud', instrumentId: 'kazoo' })).toMatchObject({
      a4: 440,
      instrumentId: 'guitar',
    });
  });
});
