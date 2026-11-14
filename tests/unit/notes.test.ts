import { describe, expect, it } from 'vitest';
import {
  centsBetween,
  frequencyToMidi,
  midiToFrequency,
  nearestNote,
  noteLabel,
  parseNote,
} from '../../src/music/notes';
import {
  CHROMATIC_ID,
  INSTRUMENTS,
  detectionRange,
  findInstrument,
  findTuning,
} from '../../src/music/tunings';

describe('frequency <-> note conversion', () => {
  it('maps MIDI notes to equal-tempered frequencies', () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(57)).toBeCloseTo(220, 10);
    expect(midiToFrequency(22)).toBeCloseTo(29.1352, 4); // A#0
    expect(midiToFrequency(23)).toBeCloseTo(30.8677, 4); // B0
    expect(midiToFrequency(28)).toBeCloseTo(41.2034, 4); // E1
    expect(midiToFrequency(40)).toBeCloseTo(82.4069, 4); // E2
    expect(midiToFrequency(76)).toBeCloseTo(659.2551, 4); // E5
  });

  it('respects the A4 calibration', () => {
    expect(midiToFrequency(69, 432)).toBe(432);
    expect(midiToFrequency(57, 450)).toBeCloseTo(225, 10);
    expect(midiToFrequency(60, 442)).toBeCloseTo(442 * 2 ** (-9 / 12), 10);
    expect(frequencyToMidi(432, 432)).toBeCloseTo(69, 10);
  });

  it('round-trips every note at several calibrations', () => {
    for (const a4 of [430, 440, 445.5, 450]) {
      for (let midi = 21; midi <= 100; midi++) {
        expect(frequencyToMidi(midiToFrequency(midi, a4), a4)).toBeCloseTo(midi, 9);
      }
    }
  });

  it('measures intervals in cents', () => {
    expect(centsBetween(440, 440)).toBe(0);
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 10);
    expect(centsBetween(220, 440)).toBeCloseTo(-1200, 10);
    expect(centsBetween(440 * 2 ** (10 / 1200), 440)).toBeCloseTo(10, 9);
    expect(centsBetween(440 * 2 ** (-3 / 1200), 440)).toBeCloseTo(-3, 9);
  });

  it('finds the nearest note and the deviation in cents', () => {
    const sharp = nearestNote(440 * 2 ** (19 / 1200));
    expect(sharp.midi).toBe(69);
    expect(sharp.cents).toBeCloseTo(19, 9);
    expect(sharp.frequency).toBe(440);

    const flat = nearestNote(midiToFrequency(40) * 2 ** (-42 / 1200));
    expect(flat.midi).toBe(40);
    expect(flat.cents).toBeCloseTo(-42, 9);

    // More than 50 cents away belongs to the next semitone.
    const next = nearestNote(440 * 2 ** (60 / 1200));
    expect(next.midi).toBe(70);
    expect(next.cents).toBeCloseTo(-40, 9);
  });

  it('measures the deviation against the calibrated reference', () => {
    const at432 = nearestNote(440, 432);
    expect(at432.midi).toBe(69);
    expect(at432.cents).toBeCloseTo(1200 * Math.log2(440 / 432), 9);
    expect(nearestNote(445, 445).cents).toBeCloseTo(0, 9);
    expect(nearestNote(midiToFrequency(40, 436), 436)).toMatchObject({ midi: 40 });
    expect(nearestNote(midiToFrequency(40, 436), 436).cents).toBeCloseTo(0, 9);
  });
});

describe('note names', () => {
  it('parses scientific pitch notation', () => {
    expect(parseNote('A4')).toBe(69);
    expect(parseNote('C4')).toBe(60);
    expect(parseNote('C-1')).toBe(0);
    expect(parseNote('A#0')).toBe(22);
    expect(parseNote('Bb0')).toBe(22);
    expect(parseNote('B0')).toBe(23);
    expect(parseNote('E1')).toBe(28);
    expect(parseNote('f#3')).toBe(54);
    expect(parseNote('E5')).toBe(76);
    expect(() => parseNote('H2')).toThrow();
    expect(() => parseNote('E')).toThrow();
  });

  it('labels notes with letters or solfege, sharps or flats', () => {
    expect(noteLabel(61, { notation: 'letters', accidental: 'sharp' }).text).toBe('C♯4');
    expect(noteLabel(61, { notation: 'letters', accidental: 'flat' }).text).toBe('D♭4');
    expect(noteLabel(61, { notation: 'solfege', accidental: 'sharp' }).text).toBe('Do♯4');
    expect(noteLabel(61, { notation: 'solfege', accidental: 'flat' }).text).toBe('Re♭4');
    expect(noteLabel(69, { notation: 'letters', accidental: 'flat' }).text).toBe('A4');
    expect(noteLabel(71, { notation: 'solfege', accidental: 'sharp' }).text).toBe('Si4');
    expect(noteLabel(22, { notation: 'letters', accidental: 'sharp' }).text).toBe('A♯0');
    expect(noteLabel(22, { notation: 'letters', accidental: 'flat' }).text).toBe('B♭0');
    expect(noteLabel(40, { notation: 'solfege', accidental: 'sharp' })).toEqual({
      base: 'Mi',
      accidental: '',
      octave: 2,
      text: 'Mi2',
    });
  });

  it('round-trips labels through the parser', () => {
    for (let midi = 12; midi <= 108; midi++) {
      for (const accidental of ['sharp', 'flat'] as const) {
        const label = noteLabel(midi, { notation: 'letters', accidental });
        expect(parseNote(label.text)).toBe(midi);
      }
    }
  });
});

describe('instruments and tunings', () => {
  const names = (ids: number[]) =>
    ids.map((midi) => noteLabel(midi, { notation: 'letters', accidental: 'sharp' }).text);

  it('defines the expected tunings from the lowest string to the highest', () => {
    const guitar = findInstrument('guitar');
    expect(names(findTuning(guitar, 'standard')!.strings)).toEqual(
      ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    );
    expect(names(findTuning(guitar, 'open-d')!.strings)).toEqual(
      ['D2', 'A2', 'D3', 'F♯3', 'A3', 'D4'],
    );
    expect(names(findTuning(findInstrument('bass-5'), 'half-step-down')!.strings)).toEqual(
      ['A♯0', 'D♯1', 'G♯1', 'C♯2', 'F♯2'],
    );
    expect(names(findTuning(findInstrument('ukulele'), 'standard')!.strings)).toEqual(
      ['G4', 'C4', 'E4', 'A4'],
    );
    expect(names(findTuning(findInstrument('cavaquinho'), 'dgbe')!.strings)).toEqual(
      ['D4', 'G4', 'B4', 'E5'],
    );
  });

  it('lists all ten strings of the viola caipira with their own octaves', () => {
    const viola = findInstrument('viola-caipira');
    expect(viola.stringsPerCourse).toBe(2);
    expect(names(findTuning(viola, 'cebolao-d')!.strings)).toEqual(
      ['A2', 'A3', 'D3', 'D4', 'F♯3', 'F♯4', 'A3', 'A3', 'D4', 'D4'],
    );
    expect(names(findTuning(viola, 'cebolao-e')!.strings)).toEqual(
      ['B2', 'B3', 'E3', 'E4', 'G♯3', 'G♯4', 'B3', 'B3', 'E4', 'E4'],
    );
    expect(names(findTuning(viola, 'rio-abaixo')!.strings)).toEqual(
      ['G2', 'G3', 'D3', 'D4', 'G3', 'G4', 'B3', 'B3', 'D4', 'D4'],
    );
  });

  it('uses unique ids and falls back to defaults for unknown ids', () => {
    expect(new Set(INSTRUMENTS.map((i) => i.id)).size).toBe(INSTRUMENTS.length);
    for (const instrument of INSTRUMENTS) {
      expect(new Set(instrument.tunings.map((t) => t.id)).size).toBe(instrument.tunings.length);
    }
    expect(findInstrument('does-not-exist').id).toBe('guitar');
    expect(findTuning(findInstrument('guitar'), 'does-not-exist')!.id).toBe('standard');
    expect(findTuning(findInstrument(CHROMATIC_ID), 'standard')).toBeNull();
  });

  it('derives the detection range from the strings', () => {
    expect(detectionRange([], 440)).toEqual({ minFreq: 27, maxFreq: 2000 });

    const bass = findTuning(findInstrument('bass-5'), 'half-step-down')!;
    expect(detectionRange(bass.strings, 440).minFreq).toBe(27);
    expect(detectionRange(bass.strings, 440).maxFreq).toBeCloseTo(midiToFrequency(42 + 7), 6);

    const guitar = findTuning(findInstrument('guitar'), 'standard')!;
    const range = detectionRange(guitar.strings, 442);
    expect(range.minFreq).toBeCloseTo(midiToFrequency(40 - 5, 442), 6);
    expect(range.maxFreq).toBeCloseTo(midiToFrequency(64 + 7, 442), 6);
  });
});
