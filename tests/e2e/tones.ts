import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Chrome's fake capture device runs at 48 kHz; matching it avoids resampling. */
const SAMPLE_RATE = 48000;
const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.fixtures');

export interface Tone {
  /** Absolute path of the WAV file. */
  file: string;
  /** Fundamental frequency in Hz. */
  frequency: number;
  seconds: number;
  /** Relative amplitude of each harmonic, starting with the fundamental. */
  harmonics: number[];
}

/**
 * Chrome plays the file in a loop, so every tone lasts a whole number of
 * periods: the loop point is then seamless and the pitch stays exact.
 */
function tone(name: string, periods: number, seconds: number, harmonics: number[] = [1]): Tone {
  return {
    file: path.join(FIXTURES_DIR, `${name}.wav`),
    frequency: periods / seconds,
    seconds,
    harmonics,
  };
}

export const TONES = {
  /** A2, the fifth string of a guitar, exactly in tune. */
  a2: tone('a2-110hz', 220, 2),
  /** A sharp E2 (the note is 82.41 Hz): about 19 cents too high. */
  e2Sharp: tone('e2-sharp-83.33hz', 250, 3),
  /** A4 at concert pitch. */
  a4: tone('a4-440hz', 880, 2),
  /** A low B (30.83 Hz) with harmonics 2 to 8 only, like a phone microphone hears it. */
  b0Harmonics: tone('b0-harmonics-30.83hz', 185, 6, [0, 1, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]),
} satisfies Record<string, Tone>;

function encodeWav(samples: Float64Array): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // bytes per second
  buffer.writeUInt16LE(2, 32); // bytes per frame
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  }
  return buffer;
}

/** Writes every test tone as a 16-bit mono WAV file. */
export function writeToneFiles(): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  for (const { file, frequency, seconds, harmonics } of Object.values(TONES)) {
    const samples = new Float64Array(Math.round(seconds * SAMPLE_RATE));
    const scale = 0.5 / harmonics.reduce((sum, amplitude) => sum + amplitude, 0);
    harmonics.forEach((amplitude, index) => {
      if (amplitude === 0) return;
      const omega = (2 * Math.PI * (index + 1) * frequency) / SAMPLE_RATE;
      for (let i = 0; i < samples.length; i++) {
        samples[i] = samples[i]! + scale * amplitude * Math.sin(omega * i + index);
      }
    });
    writeFileSync(file, encodeWav(samples));
  }
}
