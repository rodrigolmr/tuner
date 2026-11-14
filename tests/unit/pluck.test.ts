import { describe, expect, it } from 'vitest';
import { PLUCK_VOICES, pluckVoiceFor, synthesizePluck } from '../../src/audio/pluck';
import { centsBetween, midiToFrequency, parseNote } from '../../src/music/notes';
import { INSTRUMENTS, detectionRange } from '../../src/music/tunings';
import { PitchDetector } from '../../src/pitch/detector';

const SAMPLE_RATES = [44100, 48000];

/** Every instrument that has strings, with each pitch its tunings ask for. */
const STRINGED = INSTRUMENTS.filter((instrument) => instrument.tunings.length > 0).map(
  (instrument) => ({
    id: instrument.id,
    strings: [...new Set(instrument.tunings.flatMap((tuning) => tuning.strings))],
  }),
);

/** RMS level of the stretch of `samples` between two moments, in seconds. */
function level(samples: Float32Array, sampleRate: number, from: number, to: number): number {
  const start = Math.round(from * sampleRate);
  const end = Math.round(to * sampleRate);
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (end - start));
}

/**
 * How bright a stretch of sound is: the level of the change from one sample
 * to the next, which grows with frequency, relative to the level itself.
 */
function brightness(samples: Float32Array, sampleRate: number, from: number, to: number): number {
  const start = Math.round(from * sampleRate);
  const end = Math.round(to * sampleRate);
  let change = 0;
  let sum = 0;
  for (let i = start + 1; i < end; i++) {
    change += (samples[i]! - samples[i - 1]!) ** 2;
    sum += samples[i]! * samples[i]!;
  }
  return change / sum;
}

it('has a voice for every instrument with strings', () => {
  for (const { id } of STRINGED) expect(PLUCK_VOICES[id], id).toBeDefined();
});

describe.each(SAMPLE_RATES)('plucked string at %i Hz', (sampleRate) => {
  describe.each(STRINGED)('$id', ({ id, strings }) => {
    const voice = pluckVoiceFor(id);

    it('is in tune: the tuner reads every string within 1 cent', () => {
      for (const a4 of [440, 432]) {
        const detector = new PitchDetector({ sampleRate, ...detectionRange(strings, a4) });
        for (const midi of strings) {
          const frequency = midiToFrequency(midi, a4);
          const samples = synthesizePluck(frequency, sampleRate, voice);
          // Shortly after the pluck and well into the note.
          for (const seconds of [0.2, 1]) {
            const end = Math.round(seconds * sampleRate) + detector.windowSize;
            const result = detector.detect(samples.subarray(end - detector.windowSize, end));
            expect(result, `no pitch for ${frequency.toFixed(2)} Hz`).not.toBeNull();
            expect(
              Math.abs(centsBetween(result!.frequency, frequency)),
              `${result!.frequency.toFixed(3)} Hz for ${frequency.toFixed(3)} Hz at ${seconds} s`,
            ).toBeLessThan(1);
          }
        }
      }
    });

    it('starts with the pluck and rings on while it dies away', () => {
      for (const midi of strings) {
        const samples = synthesizePluck(midiToFrequency(midi), sampleRate, voice);
        const seconds = samples.length / sampleRate;
        expect(seconds).toBeGreaterThanOrEqual(1.5);
        expect(seconds).toBeLessThanOrEqual(5);

        let peak = 0;
        let peakIndex = 0;
        for (let i = 0; i < samples.length; i++) {
          if (Math.abs(samples[i]!) > peak) {
            peak = Math.abs(samples[i]!);
            peakIndex = i;
          }
        }
        // Loud enough to hear, never clipped, and loudest at the pluck.
        expect(peak).toBeGreaterThan(0.3);
        expect(peak).toBeLessThanOrEqual(0.86);
        expect(peakIndex / sampleRate).toBeLessThan(0.1);
        // No click at either end.
        expect(samples[0]).toBe(0);
        expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(1e-3);

        const start = level(samples, sampleRate, 0, 0.1);
        const later = level(samples, sampleRate, 0.5, 0.6);
        const last = level(samples, sampleRate, seconds - 0.5, seconds - 0.4);
        expect(later).toBeLessThan(start);
        // Half a second in the note is still clearly there (within 30 dB)...
        expect(later).toBeGreaterThan(start / 30);
        // ...and by the end it has faded a lot (20 dB or more), even on a bass.
        expect(last).toBeLessThan(start / 10);
      }
    });

    it('turns mellow as it rings', () => {
      for (const midi of strings) {
        const samples = synthesizePluck(midiToFrequency(midi), sampleRate, voice);
        expect(brightness(samples, sampleRate, 0.02, 0.12)).toBeGreaterThan(
          brightness(samples, sampleRate, 0.7, 0.8),
        );
      }
    });
  });
});

describe('instrument voices', () => {
  const sampleRate = 48000;
  const E4 = midiToFrequency(parseNote('E4'));

  it('rings longer on a guitar than on a ukulele', () => {
    const guitar = synthesizePluck(E4, sampleRate, pluckVoiceFor('guitar'));
    const ukulele = synthesizePluck(E4, sampleRate, pluckVoiceFor('ukulele'));
    expect(guitar.length).toBeGreaterThan(1.3 * ukulele.length);
  });

  it('is brighter with a pick on steel strings than with a fingertip on nylon', () => {
    const D4 = midiToFrequency(parseNote('D4'));
    const cavaquinho = synthesizePluck(D4, sampleRate, pluckVoiceFor('cavaquinho'));
    const guitar = synthesizePluck(D4, sampleRate, pluckVoiceFor('guitar'));
    expect(brightness(cavaquinho, sampleRate, 0.02, 0.12)).toBeGreaterThan(
      2 * brightness(guitar, sampleRate, 0.02, 0.12),
    );
  });

  it('gives an unknown instrument the guitar voice', () => {
    expect(pluckVoiceFor('kazoo')).toBe(pluckVoiceFor('guitar'));
  });
});
