export interface SmootherOptions {
  /** Number of recent readings the median is taken over. */
  medianSize?: number;
  /** Readings further than this from the current estimate are treated as jumps, in cents. */
  jumpCents?: number;
  /** Consecutive readings that have to agree before a jump is accepted. */
  confirmReadings?: number;
  /** Readings that have to agree before the first note is reported. */
  startReadings?: number;
  /** How long the last estimate is held when readings stop, in milliseconds. */
  holdMs?: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Turns the raw frame-by-frame detector output into a steady pitch.
 *
 * - The output is the median of the last few readings, which removes single
 *   outliers without lagging behind like an average does.
 * - A reading far from the current estimate (typically an octave error
 *   during the attack of a note) is ignored unless the following readings
 *   agree with it, in which case it is a new note and the estimate jumps.
 * - Short gaps are bridged by holding the last estimate.
 *
 * Pitches are handled as log2(frequency) so that distances are musical
 * intervals.
 */
export class PitchSmoother {
  private readonly medianSize: number;
  private readonly jump: number;
  private readonly confirmReadings: number;
  private readonly startReadings: number;
  private readonly holdMs: number;

  private history: number[] = [];
  private pending: number[] = [];
  private lastReadingMs = -Infinity;

  constructor(options: SmootherOptions = {}) {
    this.medianSize = options.medianSize ?? 5;
    this.jump = (options.jumpCents ?? 80) / 1200;
    this.confirmReadings = options.confirmReadings ?? 3;
    this.startReadings = options.startReadings ?? 2;
    this.holdMs = options.holdMs ?? 250;
  }

  /**
   * Feeds one reading and returns the smoothed frequency.
   *
   * @param frequency Detected frequency in Hz, or null when the frame had no confident pitch.
   * @param timeMs Timestamp of the frame.
   * @returns The smoothed frequency in Hz, or null when there is no note.
   */
  push(frequency: number | null, timeMs: number): number | null {
    if (frequency === null || !(frequency > 0)) {
      if (timeMs - this.lastReadingMs > this.holdMs) this.reset();
      return this.current();
    }
    this.lastReadingMs = timeMs;
    const pitch = Math.log2(frequency);

    if (this.history.length > 0 && Math.abs(pitch - median(this.history)) <= this.jump) {
      this.history.push(pitch);
      if (this.history.length > this.medianSize) this.history.shift();
      this.pending.length = 0;
      return this.current();
    }

    // Either there is no note yet or this reading disagrees with it: collect
    // readings that agree with each other until there are enough of them.
    const last = this.pending[this.pending.length - 1];
    if (last !== undefined && Math.abs(pitch - last) > this.jump) this.pending.length = 0;
    this.pending.push(pitch);
    const needed = this.history.length > 0 ? this.confirmReadings : this.startReadings;
    if (this.pending.length >= needed) {
      this.history = this.pending.slice(-this.medianSize);
      this.pending = [];
    }
    return this.current();
  }

  /** Current estimate in Hz, or null when there is no note. */
  current(): number | null {
    return this.history.length > 0 ? 2 ** median(this.history) : null;
  }

  reset(): void {
    this.history = [];
    this.pending = [];
    this.lastReadingMs = -Infinity;
  }
}

/** First-order low-pass (exponential moving average) with a time constant. */
export class ExponentialFilter {
  private value: number | null = null;

  constructor(private readonly timeConstantMs: number) {}

  /** Moves the filtered value towards `input` and returns it. */
  update(input: number, elapsedMs: number): number {
    if (this.value === null) {
      this.value = input;
    } else {
      this.value += (1 - Math.exp(-Math.max(0, elapsedMs) / this.timeConstantMs)) * (input - this.value);
    }
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}
