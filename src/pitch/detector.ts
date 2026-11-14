import { designLowPass, filterAndDecimate, removeMean, tapsForTransition } from './fir';
import {
  NsdfAnalyzer,
  differenceNorm,
  parabolicVertex,
  pickPeriod,
  squareDifference,
  taperWeights,
} from './nsdf';

export interface PitchDetectorOptions {
  /** Sample rate of the audio passed to `detect`, in Hz. */
  sampleRate: number;
  /** Lowest fundamental the detector has to find, in Hz. */
  minFreq: number;
  /** Highest fundamental the detector has to find, in Hz. */
  maxFreq: number;
}

export interface PitchEstimate {
  /** Fundamental frequency in Hz. */
  frequency: number;
  /** How periodic the signal is, from 0 to 1 (height of the NSDF peak). */
  clarity: number;
}

/** The analysis window spans this many periods of the lowest frequency. */
const WINDOW_PERIODS = 4;
/** Shortest analysis window; shorter ones respond faster but get noisy. */
const MIN_WINDOW_SECONDS = 0.045;
/** McLeod's "k": the first NSDF peak above k times the highest one wins. */
const PEAK_THRESHOLD = 0.9;

/**
 * The coarse stage keeps at least this much bandwidth so that notes whose
 * fundamental is missing (phone microphones barely pick up anything below
 * 100 Hz) still have enough harmonics left to reveal their period.
 */
const COARSE_MIN_CUTOFF_HZ = 800;
const COARSE_CUTOFF_PER_MAX_FREQ = 1.5;
/** The coarse filter is flat up to this multiple of the highest frequency. */
const COARSE_PASSBAND_PER_MAX_FREQ = 1.1;
/** Widest transition band of the coarse filter, relative to its cutoff. */
const COARSE_MAX_TRANSITION = 0.8;
/**
 * Decimated sample rate of the coarse stage, relative to its cutoff. It has
 * to be high enough for the NSDF peaks to be well sampled: peak heights are
 * compared with each other to decide the octave.
 */
const COARSE_RATE_PER_CUTOFF = 8;

/** Decimated samples per period that the fine stage aims for. */
const FINE_SAMPLES_PER_PERIOD = 52;
/** Number of harmonics the fine stage keeps (-6 dB point of its filter). */
const FINE_HARMONICS = 6;
/**
 * Parabolic interpolation is only accurate while the NSDF peak is smooth at
 * the sample scale. Keeping at most sqrt(c * samplesPerPeriod^3) harmonics
 * bounds the interpolation bias to about 0.1 cent.
 */
const FINE_SMOOTHNESS = 2.7e-4;
const FINE_MIN_HARMONICS = 1.6;
/** Fraction of the harmonics that sits in the flat part of the passband. */
const FINE_PASSBAND = 0.45;
/** Lags searched around the coarse estimate, as a fraction of the period. */
const FINE_SEARCH = 0.04;
/**
 * Fraction of the fine stage's summation range that fades in and out at each
 * end. Fading removes the bias caused by samples entering and leaving the
 * range; fading less keeps more of the window, which helps against noise.
 */
const FINE_TAPER = 0.25;
/** A fine band this periodic is trusted without looking at wider ones. */
const FINE_GOOD_CLARITY = 0.85;
/** Below this, the fine measurement is discarded in favour of the coarse one. */
const FINE_MIN_CLARITY = 0.5;
const FINE_WIDENINGS = [1, 2, 4];
const MAX_CACHED_BANDS = 256;

interface FineBand {
  factor: number;
  harmonics: number;
  kernel: Float64Array;
}

/**
 * Pitch detector based on the McLeod Pitch Method, in two stages.
 *
 * 1. Coarse: the window is low-pass filtered and decimated, the NSDF is
 *    computed for every lag in range and McLeod's peak picking decides which
 *    period (and therefore which octave) is the fundamental. Working on the
 *    period of the waveform is what makes a weak or missing fundamental a
 *    non-issue: the harmonics alone repeat with the same period.
 * 2. Fine: the window is filtered again down to the first few harmonics of
 *    that note and resampled to roughly 50-100 samples per period. The
 *    square difference (the unnormalized form of the NSDF, as in YIN) is
 *    evaluated only around the coarse period and its minimum is located with
 *    parabolic interpolation. Few harmonics and many samples per period keep
 *    that minimum smooth, which is what parabolic interpolation needs, and
 *    the low harmonics are the least affected by string stiffness.
 */
export class PitchDetector {
  readonly sampleRate: number;
  readonly minFreq: number;
  readonly maxFreq: number;
  /** Number of samples `detect` analyses. */
  readonly windowSize: number;

  private readonly coarseKernel: Float64Array;
  private readonly coarseFactor: number;
  private readonly coarseRate: number;
  private readonly coarse: Float64Array;
  private readonly analyzer: NsdfAnalyzer;
  private readonly nsdf: Float64Array;
  private readonly minLag: number;
  private readonly maxLag: number;

  private readonly fine: Float64Array;
  private readonly fineWeights: Float64Array;
  private readonly bands = new Map<number, FineBand>();

  constructor(options: PitchDetectorOptions) {
    const { sampleRate } = options;
    this.sampleRate = sampleRate;
    this.maxFreq = Math.min(options.maxFreq, sampleRate / 8);
    this.minFreq = Math.min(options.minFreq, this.maxFreq / 2);

    const cutoff = Math.min(
      Math.max(COARSE_CUTOFF_PER_MAX_FREQ * this.maxFreq, COARSE_MIN_CUTOFF_HZ),
      0.35 * sampleRate,
    );
    const transition = Math.min(
      COARSE_MAX_TRANSITION * cutoff,
      2 * (cutoff - COARSE_PASSBAND_PER_MAX_FREQ * this.maxFreq),
    );
    this.coarseKernel = designLowPass(
      cutoff / sampleRate,
      tapsForTransition(transition / sampleRate),
    );
    this.coarseFactor = Math.max(1, Math.round(sampleRate / (COARSE_RATE_PER_CUTOFF * cutoff)));
    this.coarseRate = sampleRate / this.coarseFactor;

    const analysisSeconds = Math.max(WINDOW_PERIODS / this.minFreq, MIN_WINDOW_SECONDS);
    this.windowSize = Math.ceil(analysisSeconds * sampleRate) + this.coarseKernel.length - 1;

    const coarseLength =
      Math.floor((this.windowSize - this.coarseKernel.length) / this.coarseFactor) + 1;
    this.coarse = new Float64Array(coarseLength);
    this.minLag = Math.max(2, Math.floor(this.coarseRate / this.maxFreq));
    this.maxLag = Math.min(coarseLength - 2, Math.ceil(this.coarseRate / this.minFreq) + 1);
    this.nsdf = new Float64Array(this.maxLag + 1);
    this.analyzer = new NsdfAnalyzer(coarseLength, this.maxLag);

    this.fine = new Float64Array(this.windowSize);
    this.fineWeights = new Float64Array(this.windowSize);
  }

  /**
   * Estimates the pitch of the last `windowSize` samples. Returns null when
   * the window holds no periodic signal within the configured range.
   */
  detect(samples: Float32Array): PitchEstimate | null {
    if (samples.length < this.windowSize) return null;
    const input =
      samples.length === this.windowSize
        ? samples
        : samples.subarray(samples.length - this.windowSize);

    const length = filterAndDecimate(
      input,
      this.windowSize,
      this.coarseKernel,
      this.coarseFactor,
      this.coarse,
    );
    removeMean(this.coarse, length);
    this.analyzer.compute(this.coarse, length, this.maxLag, this.nsdf);

    const peak = pickPeriod(this.nsdf, this.minLag, this.maxLag, PEAK_THRESHOLD);
    if (!peak) return null;

    const coarseFrequency = this.coarseRate / peak.lag;
    const frequency = this.refine(input, coarseFrequency) ?? coarseFrequency;
    return { frequency, clarity: Math.min(1, peak.clarity) };
  }

  /**
   * Fine stage: measures the period again using only the lowest harmonics.
   * When those are too weak to be periodic on their own (missing fundamental
   * on a noisy signal), progressively wider bands are tried.
   */
  private refine(input: Float32Array, coarseFrequency: number): number | null {
    let best: PitchEstimate | null = null;
    let previous: FineBand | null = null;
    for (const widening of FINE_WIDENINGS) {
      const band = this.bandFor(coarseFrequency, widening);
      if (previous && band.factor === previous.factor && band.harmonics === previous.harmonics) {
        break;
      }
      previous = band;
      const estimate = this.measure(input, band, coarseFrequency);
      if (!estimate) continue;
      if (estimate.clarity >= FINE_GOOD_CLARITY) return estimate.frequency;
      if (!best || estimate.clarity > best.clarity) best = estimate;
    }
    return best && best.clarity >= FINE_MIN_CLARITY ? best.frequency : null;
  }

  /** Filter and decimation factor for notes around `frequency`, cached per semitone. */
  private bandFor(frequency: number, widening: number): FineBand {
    const semitone = Math.round(12 * Math.log2(frequency));
    const key = semitone * 8 + widening;
    const cached = this.bands.get(key);
    if (cached) return cached;

    const period = this.sampleRate / 2 ** (semitone / 12);
    const factor = Math.max(1, Math.floor(period / (FINE_SAMPLES_PER_PERIOD * widening)));
    const decimatedPeriod = period / factor;
    const harmonics = Math.min(
      FINE_HARMONICS * widening,
      Math.max(FINE_MIN_HARMONICS, Math.sqrt(FINE_SMOOTHNESS * decimatedPeriod ** 3)),
    );
    // The fundamental always stays in the flat part of the passband.
    const passband = Math.max(1.05, FINE_PASSBAND * harmonics);
    const transition = (2 * (harmonics - passband)) / period;
    const band: FineBand = {
      factor,
      harmonics,
      kernel: designLowPass(harmonics / period, tapsForTransition(transition)),
    };

    if (this.bands.size >= MAX_CACHED_BANDS) this.bands.clear();
    this.bands.set(key, band);
    return band;
  }

  private measure(input: Float32Array, band: FineBand, coarseFrequency: number): PitchEstimate | null {
    const signal = this.fine;
    const weights = this.fineWeights;
    const length = filterAndDecimate(input, this.windowSize, band.kernel, band.factor, signal);
    const rate = this.sampleRate / band.factor;
    const expected = rate / coarseFrequency;

    const first = Math.max(2, Math.floor(expected * (1 - FINE_SEARCH)));
    const last = Math.ceil(expected * (1 + FINE_SEARCH));
    // Every lag is compared over the same samples, at least two periods long.
    const terms = length - (last + 1);
    if (terms < 2 * (last + 1)) return null;

    removeMean(signal, length);
    taperWeights(weights, terms, FINE_TAPER);

    let bestLag = first;
    let bestValue = Infinity;
    for (let lag = first; lag <= last; lag++) {
      const value = squareDifference(signal, weights, terms, lag);
      if (value < bestValue) {
        bestValue = value;
        bestLag = lag;
      }
    }
    const before = squareDifference(signal, weights, terms, bestLag - 1);
    const after = squareDifference(signal, weights, terms, bestLag + 1);
    // The minimum has to be inside the search range, not on its edge.
    if (before < bestValue || after < bestValue) return null;

    const vertex = parabolicVertex(before, bestValue, after);
    const norm = differenceNorm(signal, weights, terms, bestLag);
    const clarity = norm > 0 ? 1 - Math.max(0, vertex.value) / norm : 0;
    return { frequency: rate / (bestLag + vertex.offset), clarity };
  }
}
