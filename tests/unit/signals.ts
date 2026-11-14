/** Synthetic test signals with a known fundamental frequency. */

/** Small deterministic PRNG so that noisy tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Partial {
  /** Frequency in Hz. */
  frequency: number;
  amplitude: number;
  /** Phase in radians. */
  phase?: number;
  /** Exponential decay rate in 1/s. */
  decay?: number;
}

/** Sum of (optionally decaying) sinusoids, starting `startTime` seconds in. */
export function synthesize(
  partials: readonly Partial[],
  sampleRate: number,
  length: number,
  startTime = 0,
): Float32Array {
  const out = new Float64Array(length);
  for (const partial of partials) {
    if (partial.frequency >= sampleRate / 2) continue;
    const omega = (2 * Math.PI * partial.frequency) / sampleRate;
    const phase = (partial.phase ?? 0) + 2 * Math.PI * partial.frequency * startTime;
    const decayPerSample = (partial.decay ?? 0) / sampleRate;
    const initial = partial.amplitude * Math.exp(-(partial.decay ?? 0) * startTime);
    for (let i = 0; i < length; i++) {
      out[i] = out[i]! + initial * Math.exp(-decayPerSample * i) * Math.sin(omega * i + phase);
    }
  }
  return Float32Array.from(out);
}

export function sine(frequency: number, sampleRate: number, length: number, phase = 0.7): Float32Array {
  return synthesize([{ frequency, amplitude: 0.5, phase }], sampleRate, length);
}

/** Band-limited sawtooth: every harmonic up to 20 kHz with amplitude 1/k. */
export function sawtooth(frequency: number, sampleRate: number, length: number, phase = 0.7): Float32Array {
  const partials: Partial[] = [];
  const limit = Math.min(20000, 0.45 * sampleRate);
  for (let k = 1; k * frequency < limit; k++) {
    partials.push({ frequency: k * frequency, amplitude: 0.3 / k, phase: k * phase });
  }
  return synthesize(partials, sampleRate, length);
}

/** Harmonics 2 to 6 only: the fundamental itself is absent. */
export function missingFundamental(
  frequency: number,
  sampleRate: number,
  length: number,
  seed = 1,
): Float32Array {
  const random = mulberry32(seed);
  const partials: Partial[] = [];
  for (let k = 2; k <= 6; k++) {
    partials.push({ frequency: k * frequency, amplitude: 0.15, phase: 2 * Math.PI * random() });
  }
  return synthesize(partials, sampleRate, length);
}

export interface PluckOptions {
  /** Stiffness coefficient B: partial k sits at k·f0·sqrt(1 + B·k²). */
  inharmonicity?: number;
  /** Decay rate of the fundamental in 1/s. */
  decay?: number;
  /** Where the string is plucked, as a fraction of its length. */
  position?: number;
  /** Time since the pluck at the first sample, in seconds. */
  startTime?: number;
}

/**
 * Plucked string model: partials with a pluck-position comb, exponential
 * decay that is faster for higher partials, and slightly stretched (stiff
 * string) partial frequencies. `frequency` is the frequency of the first
 * partial.
 */
export function pluckedString(
  frequency: number,
  sampleRate: number,
  length: number,
  options: PluckOptions = {},
): Float32Array {
  const b = options.inharmonicity ?? 1e-4;
  const decay = options.decay ?? 1.5;
  const position = options.position ?? 0.21;
  const partials: Partial[] = [];
  const limit = Math.min(20000, 0.45 * sampleRate);
  for (let k = 1; k <= 60; k++) {
    const partialFrequency = k * frequency * Math.sqrt((1 + b * k * k) / (1 + b));
    if (partialFrequency >= limit) break;
    partials.push({
      frequency: partialFrequency,
      amplitude: (0.5 * Math.abs(Math.sin(Math.PI * k * position))) / k,
      phase: 0.4 * k,
      decay: decay * (1 + 0.3 * (k - 1)),
    });
  }
  return synthesize(partials, sampleRate, length, options.startTime ?? 0.05);
}

function rootMeanSquare(signal: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i++) sum += signal[i]! * signal[i]!;
  return Math.sqrt(sum / signal.length);
}

/** Adds white Gaussian noise at the given signal-to-noise ratio (in dB). */
export function addWhiteNoise(signal: Float32Array, snrDb: number, seed: number): Float32Array {
  const random = mulberry32(seed);
  const sigma = rootMeanSquare(signal) / 10 ** (snrDb / 20);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    // Box-Muller transform.
    const gaussian =
      Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    out[i] = signal[i]! + sigma * gaussian;
  }
  return out;
}
