import { getAudioContext, resumeAudioContext } from './context';
import { pluckVoiceFor, synthesizePluck } from './pluck';

const STOP_FADE_SECONDS = 0.06;
/** Notes kept ready to be played again without building them anew. */
const MAX_CACHED_NOTES = 12;

interface Sound {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Plays the reference note of a string as that string sounds when it is
 * plucked on the instrument.
 */
export class ReferenceTone {
  /** Called when a note starts or stops. */
  onChange: (playing: boolean) => void = () => undefined;

  private sound: Sound | null = null;
  private readonly notes = new Map<string, AudioBuffer>();

  get playing(): boolean {
    return this.sound !== null;
  }

  /**
   * Plucks a string of the given instrument tuned to `frequency` and lets it
   * ring, replacing any note that is still sounding. Has to be called from a
   * user gesture.
   *
   * @returns Whether the note started.
   */
  async play(frequency: number, instrumentId: string): Promise<boolean> {
    this.stop();
    if (!(await resumeAudioContext())) return false;
    const audio = getAudioContext();

    const source = audio.createBufferSource();
    source.buffer = this.noteFor(audio, frequency, instrumentId);
    const gain = audio.createGain();
    source.connect(gain);
    gain.connect(audio.destination);
    source.start();

    const sound: Sound = { source, gain };
    this.sound = sound;
    source.onended = () => {
      gain.disconnect();
      if (this.sound === sound) {
        this.sound = null;
        this.onChange(false);
      }
    };
    this.onChange(true);
    return true;
  }

  /** Damps the note that is sounding. */
  stop(): void {
    const sound = this.sound;
    if (!sound) return;
    this.sound = null;
    const audio = getAudioContext();
    const now = audio.currentTime;
    const { gain } = sound.gain;
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
    try {
      sound.source.stop(now + STOP_FADE_SECONDS + 0.02);
    } catch {
      // Already stopped.
    }
    this.onChange(false);
  }

  private noteFor(audio: AudioContext, frequency: number, instrumentId: string): AudioBuffer {
    const key = `${instrumentId} ${frequency.toFixed(3)}`;
    let note = this.notes.get(key);
    if (!note) {
      const samples = synthesizePluck(frequency, audio.sampleRate, pluckVoiceFor(instrumentId));
      note = audio.createBuffer(1, samples.length, audio.sampleRate);
      note.getChannelData(0).set(samples);
      // A Map lists its keys in the order they were added: the first is the oldest.
      const oldest = this.notes.keys().next();
      if (this.notes.size >= MAX_CACHED_NOTES && !oldest.done) this.notes.delete(oldest.value);
      this.notes.set(key, note);
    }
    return note;
  }
}
