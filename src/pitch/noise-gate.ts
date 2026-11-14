/** Lowest noise floor the gate will assume (-100 dBFS). */
const MIN_FLOOR = 1e-5;
/** The gate never opens below this level, whatever the floor is (-80 dBFS). */
const MIN_THRESHOLD = 1e-4;
/** Once open, the gate closes only this far below the opening threshold. */
const CLOSE_RATIO = 0.7;

/**
 * The noise floor is tracked in decibels. Below the gate threshold it simply
 * follows the input level with these time constants (in seconds).
 */
const FALL_SECONDS = 0.3;
const RISE_CLOSED_SECONDS = 0.5;
/**
 * Above the threshold, sound without a clear pitch may be loud noise that
 * should eventually be ignored, or the attack of a note. The floor therefore
 * creeps up at a limited rate (in dB per second): slow enough for an attack
 * to leave no trace, fast enough to shut out a fan within a few seconds.
 */
const RISE_OPEN_DB_PER_SECOND = 10;
/** Right after start the floor is unknown, so it is learned faster. */
const WARM_UP_SECONDS = 1;
const WARM_UP_RISE_DB_PER_SECOND = 60;

/**
 * Noise gate driven by the RMS level relative to the ambient noise floor.
 *
 * With automatic gain control switched off, the absolute level of the
 * microphone varies a lot between devices, so a fixed threshold cannot work.
 * The gate tracks the level of everything that is not a note and opens only
 * when the signal rises a given number of decibels above it.
 */
export class NoiseGate {
  /** Estimated RMS level of the ambient noise. */
  floor = MIN_FLOOR;
  /** Whether the last frame was loud enough to be analysed. */
  open = false;
  /** How far above the noise floor a signal has to be, in dB. */
  thresholdDb: number;

  private age = 0;

  constructor(thresholdDb: number) {
    this.thresholdDb = thresholdDb;
  }

  /** RMS level at which the gate opens. */
  get threshold(): number {
    return Math.max(MIN_THRESHOLD, this.floor * 10 ** (this.thresholdDb / 20));
  }

  /** Decides whether a frame with the given RMS level should be analysed. */
  update(rms: number): boolean {
    const threshold = this.threshold;
    this.open = rms >= (this.open ? threshold * CLOSE_RATIO : threshold);
    return this.open;
  }

  /**
   * Updates the noise floor after a frame. Frames that hold a clear pitch are
   * never treated as noise, so a long steady note does not close the gate.
   *
   * @param pitched Whether the detector found a confident pitch in the frame.
   * @param seconds Time elapsed since the previous frame.
   */
  learn(rms: number, pitched: boolean, seconds: number): void {
    this.age += seconds;
    const gapDb = 20 * Math.log10(Math.max(MIN_FLOOR, rms) / this.floor);
    let stepDb: number;
    if (gapDb < 0) {
      stepDb = gapDb * (1 - Math.exp(-seconds / FALL_SECONDS));
    } else if (!this.open) {
      stepDb = gapDb * (1 - Math.exp(-seconds / RISE_CLOSED_SECONDS));
    } else if (pitched) {
      return;
    } else {
      const rate = this.age < WARM_UP_SECONDS ? WARM_UP_RISE_DB_PER_SECOND : RISE_OPEN_DB_PER_SECOND;
      stepDb = Math.min(gapDb, rate * seconds);
    }
    this.floor *= 10 ** (stepDb / 20);
  }

  reset(): void {
    this.floor = MIN_FLOOR;
    this.open = false;
    this.age = 0;
  }
}

/** RMS level of the last `count` samples of `samples`, ignoring any DC offset. */
export function rootMeanSquare(samples: Float32Array, count: number = samples.length): number {
  const length = Math.min(count, samples.length);
  if (length === 0) return 0;
  const start = samples.length - length;
  let sum = 0;
  let sumOfSquares = 0;
  for (let i = start; i < samples.length; i++) {
    sum += samples[i]!;
    sumOfSquares += samples[i]! * samples[i]!;
  }
  const mean = sum / length;
  return Math.sqrt(Math.max(0, sumOfSquares / length - mean * mean));
}
