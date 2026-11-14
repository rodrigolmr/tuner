import { Fft, nextPowerOfTwo } from './fft';

/**
 * Normalized square difference function (NSDF) from the McLeod Pitch Method:
 *
 *   n'(τ) = 2·r'(τ) / m'(τ)
 *   r'(τ) = Σ x[j]·x[j+τ]             for j = 0 .. W-τ-1
 *   m'(τ) = Σ (x[j]² + x[j+τ]²)       over the same range
 *
 * It equals 1 - d(τ)/m'(τ), where d(τ) is YIN's square difference, so a
 * periodic signal reaches 1 at its period and at every multiple of it.
 */

export interface LagEstimate {
  /** Period in samples, with sub-sample resolution. */
  lag: number;
  /** 1 for a perfectly periodic signal, lower for noisy or changing ones. */
  clarity: number;
}

export interface Vertex {
  /** Position of the vertex relative to the middle point, in samples. */
  offset: number;
  /** Value of the parabola at the vertex. */
  value: number;
}

/** Vertex of the parabola through three equally spaced points. */
export function parabolicVertex(previous: number, center: number, next: number): Vertex {
  const curvature = previous - 2 * center + next;
  if (curvature === 0) return { offset: 0, value: center };
  const offset = (0.5 * (previous - next)) / curvature;
  return { offset, value: center - 0.25 * (previous - next) * offset };
}

/** Computes the NSDF of a signal for every lag up to a maximum, using the FFT. */
export class NsdfAnalyzer {
  private readonly fft: Fft;
  private readonly real: Float64Array;
  private readonly imag: Float64Array;
  private readonly energy: Float64Array;

  constructor(maxLength: number, maxLag: number) {
    // Zero padding by at least maxLag keeps the circular correlation of the
    // FFT from wrapping around into the lags that are read back.
    this.fft = new Fft(nextPowerOfTwo(maxLength + maxLag + 1));
    this.real = new Float64Array(this.fft.size);
    this.imag = new Float64Array(this.fft.size);
    this.energy = new Float64Array(maxLength + 1);
  }

  /** Writes n'(0..maxLag) for the first `length` samples of `signal` to `output`. */
  compute(signal: Float64Array, length: number, maxLag: number, output: Float64Array): void {
    const { real, imag, energy } = this;
    const size = this.fft.size;

    let sum = 0;
    energy[0] = 0;
    for (let i = 0; i < length; i++) {
      real[i] = signal[i]!;
      sum += signal[i]! * signal[i]!;
      energy[i + 1] = sum;
    }
    real.fill(0, length);
    imag.fill(0);

    // Autocorrelation = inverse transform of the power spectrum. The power
    // spectrum is real and even, so a forward transform does the same job.
    this.fft.forward(real, imag);
    for (let i = 0; i < size; i++) {
      real[i] = real[i]! * real[i]! + imag[i]! * imag[i]!;
    }
    imag.fill(0);
    this.fft.forward(real, imag);

    for (let lag = 0; lag <= maxLag; lag++) {
      const norm = energy[length - lag]! + energy[length]! - energy[lag]!;
      output[lag] = norm > 0 ? (2 * real[lag]!) / size / norm : 0;
    }
  }
}

const candidateLags: number[] = [];
const candidateValues: number[] = [];

/**
 * McLeod peak picking. Takes the highest point of every positive lobe after
 * the one around lag 0 (the "key maxima") and returns the first one that
 * reaches `threshold` times the highest of them. Choosing the first strong
 * peak instead of the strongest one is what avoids octave errors: a periodic
 * signal also peaks at every multiple of its period.
 *
 * `nsdf` must be filled up to `maxLag`; only lags in [minLag, maxLag - 1] are
 * considered.
 */
export function pickPeriod(
  nsdf: Float64Array,
  minLag: number,
  maxLag: number,
  threshold: number,
): LagEstimate | null {
  candidateLags.length = 0;
  candidateValues.length = 0;
  let highest = 0;
  let lag = 1;
  // Skip the lobe around lag 0.
  while (lag < maxLag && nsdf[lag]! > 0) lag++;
  while (lag < maxLag) {
    while (lag < maxLag && nsdf[lag]! <= 0) lag++;
    let best = -1;
    while (lag < maxLag && nsdf[lag]! > 0) {
      const value = nsdf[lag]!;
      const isLocalMaximum = value >= nsdf[lag - 1]! && value >= nsdf[lag + 1]!;
      if (lag >= minLag && isLocalMaximum && (best < 0 || value > nsdf[best]!)) best = lag;
      lag++;
    }
    if (best >= 0) {
      // Compare interpolated heights: the true peak usually falls between
      // two lags, and how far it falls from them differs from peak to peak.
      const vertex = parabolicVertex(nsdf[best - 1]!, nsdf[best]!, nsdf[best + 1]!);
      candidateLags.push(best + vertex.offset);
      candidateValues.push(vertex.value);
      if (vertex.value > highest) highest = vertex.value;
    }
  }
  const cutoff = threshold * highest;
  for (let i = 0; i < candidateLags.length; i++) {
    if (candidateValues[i]! >= cutoff) {
      return { lag: candidateLags[i]!, clarity: candidateValues[i]! };
    }
  }
  return null;
}

/**
 * Weighted version of YIN's square difference,
 *
 *   d(τ) = Σ w[j]·(x[j] - x[j+τ])²      for j = 0 .. terms-1
 *
 * This is the function to interpolate for sub-sample precision. The
 * summation range does not depend on the lag, so for a periodic signal d(τ)
 * depends only on the distance to the true period and is zero exactly there.
 * With weights that fade out at both ends (see `taperWeights`), the samples
 * entering and leaving the range no longer skew the parabola around that
 * minimum.
 */
export function squareDifference(
  signal: Float64Array,
  weights: Float64Array,
  terms: number,
  lag: number,
): number {
  let sum = 0;
  for (let j = 0; j < terms; j++) {
    const difference = signal[j]! - signal[j + lag]!;
    sum += weights[j]! * difference * difference;
  }
  return sum;
}

/**
 * Normalization for `squareDifference`: Σ w[j]·(x[j]² + x[j+τ]²). The ratio
 * d(τ)/m(τ) is 0 for a periodic signal and close to 1 for noise.
 */
export function differenceNorm(
  signal: Float64Array,
  weights: Float64Array,
  terms: number,
  lag: number,
): number {
  let sum = 0;
  for (let j = 0; j < terms; j++) {
    const a = signal[j]!;
    const b = signal[j + lag]!;
    sum += weights[j]! * (a * a + b * b);
  }
  return sum;
}

/**
 * Fills the first `terms` entries of `weights` with a tapered (Tukey)
 * window: a raised-cosine fade over `fraction` of the length at each end and
 * 1 in between. A fraction of 0.5 gives a Hann window.
 */
export function taperWeights(weights: Float64Array, terms: number, fraction: number): void {
  const ramp = Math.max(1, Math.min(Math.floor(terms / 2), Math.round(terms * fraction)));
  weights.fill(1, 0, terms);
  // cos((j + 0.5)·step) by rotation, which avoids a cosine per sample.
  const step = Math.PI / ramp;
  const stepCos = Math.cos(step);
  const stepSin = Math.sin(step);
  let cos = Math.cos(step / 2);
  let sin = Math.sin(step / 2);
  for (let j = 0; j < ramp; j++) {
    const weight = 0.5 - 0.5 * cos;
    weights[j] = weight;
    weights[terms - 1 - j] = weight;
    const next = cos * stepCos - sin * stepSin;
    sin = sin * stepCos + cos * stepSin;
    cos = next;
  }
}
