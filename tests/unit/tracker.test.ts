import { describe, expect, it } from 'vitest';
import { centsBetween, midiToFrequency, parseNote } from '../../src/music/notes';
import { detectionRange, findInstrument, findTuning } from '../../src/music/tunings';
import { NoiseGate, rootMeanSquare } from '../../src/pitch/noise-gate';
import { ExponentialFilter, PitchSmoother } from '../../src/pitch/smoother';
import { PitchTracker, type TrackerReading } from '../../src/pitch/tracker';
import { mulberry32, pluckedString, sine } from './signals';

const SAMPLE_RATE = 48000;
const HOP = 1024;
const E2 = midiToFrequency(parseNote('E2'));

function whiteNoise(seconds: number, rms: number, seed: number): Float32Array {
  const random = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = rms * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function mix(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((value, i) => value + (b[i] ?? 0));
}

function guitarTracker(gateDb = 12): PitchTracker {
  const range = detectionRange(findTuning(findInstrument('guitar'), 'standard')!.strings, 440);
  return new PitchTracker({ sampleRate: SAMPLE_RATE, ...range, gateDb });
}

interface TimedReading extends TrackerReading {
  /** Time of the end of the frame, in seconds. */
  time: number;
}

/** Feeds a recording through the tracker the way the live audio loop does. */
function run(tracker: PitchTracker, signal: Float32Array): TimedReading[] {
  const readings: TimedReading[] = [];
  for (let end = tracker.windowSize; end <= signal.length; end += HOP) {
    const frame = signal.subarray(end - tracker.windowSize, end);
    const time = end / SAMPLE_RATE;
    readings.push({ ...tracker.process(frame, time * 1000), time });
  }
  return readings;
}

const between = (readings: TimedReading[], from: number, to: number) =>
  readings.filter((reading) => reading.time >= from && reading.time < to);

describe('PitchTracker', () => {
  it('shows a plucked note only while it sounds', () => {
    const note = pluckedString(E2, SAMPLE_RATE, 2 * SAMPLE_RATE, { startTime: 0 });
    const signal = concat(
      whiteNoise(1, 0.001, 1),
      mix(note, whiteNoise(2, 0.001, 2)),
      whiteNoise(1.5, 0.001, 3),
    );
    const readings = run(guitarTracker(), signal);

    for (const reading of between(readings, 0, 1)) expect(reading.frequency).toBeNull();
    // The noise floor is learned within the first few hundred milliseconds.
    for (const reading of between(readings, 0.8, 1)) expect(reading.gateOpen).toBe(false);

    const during = between(readings, 1.25, 2.95);
    expect(during.length).toBeGreaterThan(50);
    for (const reading of during) {
      expect(reading.frequency).not.toBeNull();
      expect(Math.abs(centsBetween(reading.frequency!, E2))).toBeLessThan(3);
    }

    for (const reading of between(readings, 3.45, 4.5)) expect(reading.frequency).toBeNull();
  });

  it('keeps following a steady tone on an otherwise silent input', () => {
    const readings = run(guitarTracker(), sine(E2 * 2, SAMPLE_RATE, 6 * SAMPLE_RATE));
    const steady = between(readings, 0.3, 6);
    expect(steady.length).toBeGreaterThan(200);
    for (const reading of steady) {
      expect(reading.gateOpen).toBe(true);
      expect(Math.abs(centsBetween(reading.frequency!, E2 * 2))).toBeLessThan(0.5);
    }
  });

  it('closes the gate on steady broadband noise', () => {
    const readings = run(guitarTracker(), whiteNoise(6, 0.05, 4));
    for (const reading of readings) expect(reading.frequency).toBeNull();
    for (const reading of between(readings, 5, 6)) expect(reading.gateOpen).toBe(false);
  });

  it('adapts to a noisy room and still hears a note above the noise', () => {
    const note = sine(E2, SAMPLE_RATE, 2 * SAMPLE_RATE).map((value) => 0.6 * value);
    const signal = concat(whiteNoise(3, 0.01, 5), mix(note, whiteNoise(2, 0.01, 6)));
    const readings = run(guitarTracker(), signal);
    for (const reading of between(readings, 0, 3)) expect(reading.frequency).toBeNull();
    for (const reading of between(readings, 3.3, 5)) {
      expect(Math.abs(centsBetween(reading.frequency!, E2))).toBeLessThan(3);
    }
  });

  it('ignores a sound that does not rise above the noise floor', () => {
    const faint = sine(E2, SAMPLE_RATE, 2 * SAMPLE_RATE).map((value) => 0.02 * value);
    const signal = concat(whiteNoise(3, 0.01, 7), mix(faint, whiteNoise(2, 0.01, 8)));
    for (const reading of run(guitarTracker(), signal)) expect(reading.frequency).toBeNull();
  });

  it('needs a quieter note to be closer at lower sensitivity', () => {
    // A note 9 dB above the noise passes a 6 dB gate but not an 18 dB one.
    const amplitude = 0.01 * 10 ** (9 / 20) * Math.SQRT2;
    const note = sine(E2, SAMPLE_RATE, 2 * SAMPLE_RATE).map((value) => 2 * amplitude * value);
    const signal = concat(whiteNoise(3, 0.01, 9), mix(note, whiteNoise(2, 0.01, 10)));
    expect(between(run(guitarTracker(6), signal), 4, 5).some((r) => r.gateOpen)).toBe(true);
    expect(between(run(guitarTracker(18), signal), 4, 5).some((r) => r.gateOpen)).toBe(false);
  });
});

describe('PitchSmoother', () => {
  /** Feeds readings 20 ms apart and returns the outputs. */
  const feed = (smoother: PitchSmoother, readings: Array<number | null>, startMs = 0) =>
    readings.map((reading, i) => smoother.push(reading, startMs + 20 * i));

  it('waits for two agreeing readings before reporting a note', () => {
    const out = feed(new PitchSmoother(), [110, 110.1, 110.2]);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(110.05, 2);
    expect(out[2]).toBeCloseTo(110.1, 2);
  });

  it('discards isolated octave jumps', () => {
    const out = feed(new PitchSmoother(), [110, 110, 110, 220, 110, 110, 55, 55, 110, 110]);
    for (const value of out.slice(1)) expect(value).toBeCloseTo(110, 6);
  });

  it('accepts a new note once three readings in a row agree', () => {
    const out = feed(new PitchSmoother(), [110, 110, 110, 146.8, 146.8, 146.8, 146.8]);
    expect(out[3]).toBeCloseTo(110, 6);
    expect(out[4]).toBeCloseTo(110, 6);
    expect(out[5]).toBeCloseTo(146.8, 6);
    expect(out[6]).toBeCloseTo(146.8, 6);
  });

  it('takes the median of the last readings', () => {
    const out = feed(new PitchSmoother(), [100, 100, 101, 102, 100.5, 103, 104]);
    expect(out[4]).toBeCloseTo(100.5, 6); // median of 100, 100, 101, 102, 100.5
    expect(out[6]).toBeCloseTo(102, 6); // median of 101, 102, 100.5, 103, 104
  });

  it('holds the note through short gaps and drops it after a longer one', () => {
    const smoother = new PitchSmoother({ holdMs: 250 });
    feed(smoother, [110, 110, 110]); // last reading at 40 ms
    expect(smoother.push(null, 100)).toBeCloseTo(110, 6);
    expect(smoother.push(null, 280)).toBeCloseTo(110, 6);
    expect(smoother.push(null, 300)).toBeNull();
    // A new note has to be confirmed again.
    expect(smoother.push(110, 320)).toBeNull();
    expect(smoother.push(110, 340)).toBeCloseTo(110, 6);
  });
});

describe('ExponentialFilter', () => {
  it('starts at the first value and approaches the input with its time constant', () => {
    const filter = new ExponentialFilter(100);
    expect(filter.update(10, 20)).toBe(10);
    expect(filter.update(0, 100)).toBeCloseTo(10 * Math.exp(-1), 9);
    filter.reset();
    expect(filter.update(-4, 20)).toBe(-4);
  });
});

describe('NoiseGate', () => {
  it('opens a set number of decibels above the learned noise floor', () => {
    const gate = new NoiseGate(12);
    for (let i = 0; i < 200; i++) {
      gate.update(0.01);
      gate.learn(0.01, false, 0.02);
    }
    expect(gate.floor).toBeCloseTo(0.01, 4);
    expect(gate.update(0.03)).toBe(false);
    expect(gate.update(0.041)).toBe(true);
    // Hysteresis: stays open slightly below the opening threshold.
    expect(gate.update(0.03)).toBe(true);
    expect(gate.update(0.02)).toBe(false);
  });

  it('does not learn pitched frames as noise but follows the room down', () => {
    const gate = new NoiseGate(12);
    for (let i = 0; i < 200; i++) {
      gate.update(0.01);
      gate.learn(0.01, false, 0.02);
    }
    for (let i = 0; i < 500; i++) {
      gate.update(0.2);
      gate.learn(0.2, true, 0.02);
    }
    expect(gate.floor).toBeCloseTo(0.01, 4);
    for (let i = 0; i < 200; i++) {
      gate.update(0.002);
      gate.learn(0.002, false, 0.02);
    }
    expect(gate.floor).toBeCloseTo(0.002, 4);
  });

  it('measures the level of the most recent samples without the DC offset', () => {
    const samples = new Float32Array(2000).fill(0.5);
    for (let i = 1000; i < 2000; i++) samples[i] = 0.5 + (i % 2 ? 0.1 : -0.1);
    expect(rootMeanSquare(samples, 1000)).toBeCloseTo(0.1, 6);
    expect(rootMeanSquare(samples.subarray(0, 1000))).toBeCloseTo(0, 6);
  });
});
