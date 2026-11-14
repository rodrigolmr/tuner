/** Ring buffer that keeps the most recent audio samples. */
export class FrameBuffer {
  private readonly data: Float32Array;
  private writeIndex = 0;
  private filled = 0;

  constructor(capacity: number) {
    this.data = new Float32Array(capacity);
  }

  /** Number of samples available, up to the capacity. */
  get length(): number {
    return this.filled;
  }

  /** Appends samples, overwriting the oldest ones. */
  push(samples: Float32Array): void {
    const capacity = this.data.length;
    const source = samples.length > capacity ? samples.subarray(samples.length - capacity) : samples;
    const untilEnd = Math.min(source.length, capacity - this.writeIndex);
    this.data.set(source.subarray(0, untilEnd), this.writeIndex);
    this.data.set(source.subarray(untilEnd), 0);
    this.writeIndex = (this.writeIndex + source.length) % capacity;
    this.filled = Math.min(capacity, this.filled + source.length);
  }

  /** Discards the content and stores `samples` as the most recent audio. */
  replace(samples: Float32Array): void {
    this.clear();
    this.push(samples);
  }

  /**
   * Copies the most recent `output.length` samples to `output`, oldest first.
   * Returns false when not enough samples have arrived yet.
   */
  read(output: Float32Array): boolean {
    const count = output.length;
    if (count > this.filled) return false;
    const capacity = this.data.length;
    const start = (this.writeIndex - count + capacity) % capacity;
    const untilEnd = Math.min(count, capacity - start);
    output.set(this.data.subarray(start, start + untilEnd), 0);
    output.set(this.data.subarray(0, count - untilEnd), untilEnd);
    return true;
  }

  clear(): void {
    this.writeIndex = 0;
    this.filled = 0;
  }
}
