import { getAudioContext, resumeAudioContext } from './context';

const PEAK_GAIN = 0.35;
const FADE_IN_SECONDS = 0.04;
const FADE_OUT_SECONDS = 0.25;
const STOP_FADE_SECONDS = 0.06;
const DEFAULT_DURATION_SECONDS = 3;

const MAX_HARMONICS = 64;
/** Harmonics above this frequency are left out. */
const HARMONIC_LIMIT_HZ = 5000;
/** Above this frequency the harmonics are rolled off to keep the timbre soft. */
const BRIGHTNESS_HZ = 900;

/**
 * Harmonic amplitudes for a tone at `frequency`. Phone speakers reproduce
 * almost nothing below 200-300 Hz, so a low note is only audible through its
 * harmonics: they fall off slowly (1/sqrt(k)) up to about 900 Hz and quickly
 * above that. A bass string therefore gets dozens of harmonics while a high
 * note stays close to a sine.
 */
export function harmonicAmplitudes(frequency: number): number[] {
  const count = Math.max(1, Math.min(MAX_HARMONICS, Math.floor(HARMONIC_LIMIT_HZ / frequency)));
  const amplitudes: number[] = [];
  for (let k = 1; k <= count; k++) {
    const rollOff = 1 + ((k * frequency) / BRIGHTNESS_HZ) ** 2;
    amplitudes.push(1 / (Math.sqrt(k) * rollOff));
  }
  return amplitudes;
}

interface Voice {
  oscillator: OscillatorNode;
  gain: GainNode;
}

/** Plays a reference note with a soft attack and release. */
export class ReferenceTone {
  /** Called when a tone starts or stops. */
  onChange: (playing: boolean) => void = () => undefined;

  private voice: Voice | null = null;

  get playing(): boolean {
    return this.voice !== null;
  }

  /**
   * Plays `frequency` for a few seconds, replacing any tone that is already
   * playing. Has to be called from a user gesture.
   *
   * @returns Whether the tone started.
   */
  async play(frequency: number, seconds: number = DEFAULT_DURATION_SECONDS): Promise<boolean> {
    this.stop();
    if (!(await resumeAudioContext())) return false;
    const audio = getAudioContext();

    const amplitudes = harmonicAmplitudes(frequency);
    const real = new Float32Array(amplitudes.length + 1);
    const imag = new Float32Array(amplitudes.length + 1);
    amplitudes.forEach((amplitude, i) => (imag[i + 1] = amplitude));

    const oscillator = audio.createOscillator();
    oscillator.setPeriodicWave(audio.createPeriodicWave(real, imag));
    oscillator.frequency.value = frequency;

    const gain = audio.createGain();
    const now = audio.currentTime;
    const end = now + seconds;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + FADE_IN_SECONDS);
    gain.gain.setValueAtTime(PEAK_GAIN, end - FADE_OUT_SECONDS);
    gain.gain.linearRampToValueAtTime(0, end);

    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(end + 0.02);

    const voice: Voice = { oscillator, gain };
    this.voice = voice;
    oscillator.onended = () => {
      gain.disconnect();
      if (this.voice === voice) {
        this.voice = null;
        this.onChange(false);
      }
    };
    this.onChange(true);
    return true;
  }

  /** Fades the current tone out quickly. */
  stop(): void {
    const voice = this.voice;
    if (!voice) return;
    this.voice = null;
    const audio = getAudioContext();
    const now = audio.currentTime;
    const { gain } = voice.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
    try {
      voice.oscillator.stop(now + STOP_FADE_SECONDS + 0.02);
    } catch {
      // Already stopped.
    }
    this.onChange(false);
  }
}
