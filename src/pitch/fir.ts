/**
 * Transition width of a Hamming-windowed sinc filter, as a fraction of the
 * sample rate, multiplied by the number of taps.
 */
export const HAMMING_TRANSITION_FACTOR = 3.3;

/**
 * Designs a linear-phase low-pass FIR filter (Hamming-windowed sinc) with
 * unity gain at DC.
 *
 * @param cutoff -6 dB point in cycles per sample (0 to 0.5).
 * @param taps Filter length; forced to be odd.
 */
export function designLowPass(cutoff: number, taps: number): Float64Array {
  const length = Math.max(3, taps | 1);
  const kernel = new Float64Array(length);
  const middle = (length - 1) / 2;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const t = i - middle;
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1));
    kernel[i] = sinc * window;
    sum += kernel[i]!;
  }
  for (let i = 0; i < length; i++) kernel[i] = kernel[i]! / sum;
  return kernel;
}

/** Number of taps needed for a given transition width (in cycles per sample). */
export function tapsForTransition(transitionWidth: number): number {
  return Math.ceil(HAMMING_TRANSITION_FACTOR / transitionWidth) | 1;
}

/**
 * Low-pass filters `input` and keeps one sample out of every `factor`.
 * Only positions where the kernel fits entirely inside the input are
 * computed, so the output has no edge transients.
 *
 * @returns The number of samples written to `output`.
 */
export function filterAndDecimate(
  input: ArrayLike<number>,
  inputLength: number,
  kernel: Float64Array,
  factor: number,
  output: Float64Array,
): number {
  const taps = kernel.length;
  if (inputLength < taps) return 0;
  const count = Math.min(output.length, Math.floor((inputLength - taps) / factor) + 1);
  for (let i = 0; i < count; i++) {
    const start = i * factor;
    let acc = 0;
    for (let k = 0; k < taps; k++) acc += kernel[k]! * input[start + k]!;
    output[i] = acc;
  }
  return count;
}

/** Subtracts the mean of the first `length` samples in place. */
export function removeMean(signal: Float64Array, length: number): void {
  if (length === 0) return;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += signal[i]!;
  const mean = sum / length;
  for (let i = 0; i < length; i++) signal[i] = signal[i]! - mean;
}
