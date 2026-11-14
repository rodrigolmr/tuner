import { describe, expect, it } from 'vitest';
import { centsBetween, midiToFrequency, parseNote } from '../../src/music/notes';
import {
  type FrequencyRange,
  detectionRange,
  findInstrument,
  findTuning,
} from '../../src/music/tunings';
import { PitchDetector } from '../../src/pitch/detector';
import {
  addWhiteNoise,
  missingFundamental,
  mulberry32,
  pluckedString,
  sawtooth,
  sine,
  synthesize,
} from './signals';

const SAMPLE_RATES = [44100, 48000];
const NOTES = ['A#0', 'B0', 'E1', 'E2', 'A4', 'E5'];

/** Instrument and tuning in which each test note is an open string. */
const HOME_TUNING: Record<string, [string, string]> = {
  'A#0': ['bass-5', 'half-step-down'],
  B0: ['bass-5', 'standard'],
  E1: ['bass-4', 'standard'],
  E2: ['guitar', 'standard'],
  A4: ['ukulele', 'standard'],
  E5: ['cavaquinho', 'dgbe'],
};

/** Every note is also tested slightly out of tune, as it would be on a real instrument. */
const DETUNES_CENTS = [0, -23.5, 41.7];
/** Where in its cycle the waveform is when the analysis window starts. */
const PHASES = [0, 0.7, 1.9, 3.3, 4.4, 5.6];
const NOISE_SEEDS = [1, 2, 3, 4, 5];
const SNR_DB = 20;

const CHROMATIC = detectionRange([], 440);

function tuningRange(instrument: string, tuning: string): FrequencyRange {
  return detectionRange(findTuning(findInstrument(instrument), tuning)!.strings, 440);
}

function targets(note: string): number[] {
  const nominal = midiToFrequency(parseNote(note));
  return DETUNES_CENTS.map((cents) => nominal * 2 ** (cents / 1200));
}

/** Asserts that the detector finds `expected` within `limitCents`, in the right octave. */
function expectPitch(
  detector: PitchDetector,
  signal: Float32Array,
  expected: number,
  limitCents: number,
): void {
  const result = detector.detect(signal);
  expect(result, `no pitch found for ${expected.toFixed(3)} Hz`).not.toBeNull();
  const error = centsBetween(result!.frequency, expected);
  expect(
    Math.abs(Math.round(Math.log2(result!.frequency / expected))),
    `octave error: got ${result!.frequency.toFixed(3)} Hz for ${expected.toFixed(3)} Hz`,
  ).toBe(0);
  expect(
    Math.abs(error),
    `${result!.frequency.toFixed(4)} Hz for ${expected.toFixed(4)} Hz`,
  ).toBeLessThan(limitCents);
}

describe.each(SAMPLE_RATES)('PitchDetector at %i Hz', (sampleRate) => {
  describe.each(NOTES)('%s', (note) => {
    const [instrument, tuning] = HOME_TUNING[note]!;
    const ranges: Array<[string, FrequencyRange]> = [
      [`${instrument} range`, tuningRange(instrument, tuning)],
      ['chromatic range', CHROMATIC],
    ];

    describe.each(ranges)('%s', (_name, range) => {
      const detector = new PitchDetector({ sampleRate, ...range });
      const length = detector.windowSize;

      it('measures a clean sine within 1 cent', () => {
        for (const frequency of targets(note)) {
          for (const phase of PHASES) {
            expectPitch(detector, sine(frequency, sampleRate, length, phase), frequency, 1);
          }
        }
      });

      it('measures a clean sawtooth (strong harmonics) within 1 cent', () => {
        for (const frequency of targets(note)) {
          for (const phase of PHASES) {
            expectPitch(detector, sawtooth(frequency, sampleRate, length, phase), frequency, 1);
          }
        }
      });

      it('measures harmonics 2 to 6 without the fundamental within 1 cent', () => {
        for (const frequency of targets(note)) {
          for (const seed of NOISE_SEEDS) {
            const signal = missingFundamental(frequency, sampleRate, length, seed);
            expectPitch(detector, signal, frequency, 1);
          }
        }
      });

      it(`stays within 3 cents with white noise at ${SNR_DB} dB SNR`, () => {
        for (const frequency of targets(note)) {
          for (const seed of NOISE_SEEDS) {
            const noisySine = addWhiteNoise(sine(frequency, sampleRate, length), SNR_DB, seed);
            expectPitch(detector, noisySine, frequency, 3);
            const noisySaw = addWhiteNoise(sawtooth(frequency, sampleRate, length), SNR_DB, seed);
            expectPitch(detector, noisySaw, frequency, 3);
          }
        }
      });

      it('measures a plucked string (decaying, slightly inharmonic) within 5 cents', () => {
        for (const frequency of targets(note)) {
          for (const startTime of [0.03, 0.2, 0.6]) {
            const signal = pluckedString(frequency, sampleRate, length, { startTime });
            expectPitch(detector, signal, frequency, 5);
          }
        }
      });
    });
  });
});

describe('PitchDetector robustness', () => {
  const sampleRate = 48000;

  it('reports high clarity for periodic signals', () => {
    const detector = new PitchDetector({ sampleRate, ...tuningRange('guitar', 'standard') });
    const result = detector.detect(sawtooth(110, sampleRate, detector.windowSize));
    expect(result!.clarity).toBeGreaterThan(0.95);
  });

  it('finds no pitch in silence', () => {
    const detector = new PitchDetector({ sampleRate, ...CHROMATIC });
    expect(detector.detect(new Float32Array(detector.windowSize))).toBeNull();
  });

  it('reports low clarity for white noise', () => {
    for (const range of [CHROMATIC, tuningRange('guitar', 'standard')]) {
      const detector = new PitchDetector({ sampleRate, ...range });
      for (const seed of NOISE_SEEDS) {
        const noise = addWhiteNoise(new Float32Array(detector.windowSize).fill(0.01), 0, seed);
        const result = detector.detect(noise);
        expect(result === null || result.clarity < 0.6).toBe(true);
      }
    }
  });

  it('follows a fundamental that is 40 dB weaker than its harmonics', () => {
    const detector = new PitchDetector({ sampleRate, ...tuningRange('bass-5', 'standard') });
    const random = mulberry32(7);
    for (const note of ['B0', 'E1', 'A1']) {
      const frequency = midiToFrequency(parseNote(note));
      const partials = [{ frequency, amplitude: 0.002, phase: 1 }];
      for (let k = 2; k <= 10; k++) {
        partials.push({ frequency: k * frequency, amplitude: 0.2 / k, phase: 6.28 * random() });
      }
      const signal = synthesize(partials, sampleRate, detector.windowSize);
      expectPitch(detector, signal, frequency, 1);
    }
  });

  it('follows a note whose first three harmonics are missing', () => {
    // What a phone microphone delivers for a low bass string: nothing below ~100 Hz.
    const detector = new PitchDetector({ sampleRate, ...tuningRange('bass-5', 'standard') });
    for (const note of ['B0', 'E1']) {
      const frequency = midiToFrequency(parseNote(note));
      const partials = [];
      for (let k = 4; k <= 14; k++) {
        partials.push({ frequency: k * frequency, amplitude: 0.1, phase: 0.9 * k * k });
      }
      const signal = synthesize(partials, sampleRate, detector.windowSize);
      expectPitch(detector, signal, frequency, 1);
    }
  });

  it('tells the octave strings of a viola caipira pair apart', () => {
    const detector = new PitchDetector({
      sampleRate,
      ...tuningRange('viola-caipira', 'cebolao-d'),
    });
    for (const note of ['A2', 'A3', 'D3', 'D4', 'F#3', 'F#4']) {
      const frequency = midiToFrequency(parseNote(note));
      for (const startTime of [0.03, 0.3]) {
        const signal = pluckedString(frequency, sampleRate, detector.windowSize, { startTime });
        expectPitch(detector, signal, frequency, 5);
      }
    }
  });

  it('works at other sample rates', () => {
    for (const rate of [22050, 32000, 88200, 96000]) {
      const detector = new PitchDetector({ sampleRate: rate, ...CHROMATIC });
      for (const note of ['E1', 'E2', 'A4', 'E5']) {
        const frequency = midiToFrequency(parseNote(note)) * 2 ** (12.3 / 1200);
        expectPitch(detector, sine(frequency, rate, detector.windowSize), frequency, 1);
        expectPitch(detector, sawtooth(frequency, rate, detector.windowSize), frequency, 1);
      }
    }
  });

  it('covers the whole detection range, from 27 Hz to 2000 Hz', () => {
    for (const rate of SAMPLE_RATES) {
      const detector = new PitchDetector({ sampleRate: rate, ...CHROMATIC });
      for (const frequency of [27.5, 33, 61.7, 123.4, 277.2, 554.4, 987.8, 1480, 1975.5]) {
        expectPitch(detector, sine(frequency, rate, detector.windowSize), frequency, 1);
        expectPitch(detector, sawtooth(frequency, rate, detector.windowSize), frequency, 1);
      }
    }
  });

  it('sizes the window for the lowest note and shortens it for high instruments', () => {
    const seconds = (instrument: string, tuning: string) =>
      new PitchDetector({ sampleRate, ...tuningRange(instrument, tuning) }).windowSize / sampleRate;
    const bass = seconds('bass-5', 'half-step-down');
    // At least four periods of A#0 (29.14 Hz).
    expect(bass).toBeGreaterThan(4 / 29.14);
    expect(bass).toBeLessThan(0.2);
    expect(seconds('guitar', 'standard')).toBeLessThan(bass / 2);
    expect(seconds('ukulele', 'standard')).toBeLessThan(0.06);
    expect(seconds('cavaquinho', 'dgbd')).toBeLessThan(0.06);
    expect(seconds('mandolin', 'standard')).toBeLessThan(0.06);
  });
});
