/** In-place radix-2 complex FFT with precomputed tables. */
export class Fft {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reversed: Uint32Array;

  /** @param size Transform length; must be a power of two. */
  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      const angle = (2 * Math.PI * i) / size;
      this.cos[i] = Math.cos(angle);
      this.sin[i] = Math.sin(angle);
    }
    const bits = Math.log2(size);
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) {
        if (i & (1 << bit)) reversed |= 1 << (bits - 1 - bit);
      }
      this.reversed[i] = reversed;
    }
  }

  /** Forward transform of the complex signal `real + i·imag`, in place. */
  forward(real: Float64Array, imag: Float64Array): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.reversed[i]!;
      if (j > i) {
        const r = real[i]!;
        real[i] = real[j]!;
        real[j] = r;
        const im = imag[i]!;
        imag[i] = imag[j]!;
        imag[j] = im;
      }
    }
    for (let half = 1; half < n; half <<= 1) {
      const step = n / (half << 1);
      for (let start = 0; start < n; start += half << 1) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]!;
          const wi = -this.sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const tr = real[b]! * wr - imag[b]! * wi;
          const ti = real[b]! * wi + imag[b]! * wr;
          real[b] = real[a]! - tr;
          imag[b] = imag[a]! - ti;
          real[a] = real[a]! + tr;
          imag[a] = imag[a]! + ti;
        }
      }
    }
  }
}

/** Smallest power of two that is greater than or equal to `value`. */
export function nextPowerOfTwo(value: number): number {
  let size = 2;
  while (size < value) size <<= 1;
  return size;
}
