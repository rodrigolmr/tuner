import { centsBetween, midiToFrequency, nearestNote } from '../music/notes';
import { chooseString } from '../music/string-match';
import { ExponentialFilter } from '../pitch/smoother';
import type { TunerMode } from './settings';

export type Direction = 'flat' | 'sharp' | 'in-tune';

/** Everything the screen needs to show for the current moment. */
export interface TunerView {
  /** Whether a note is sounding. */
  active: boolean;
  /** MIDI note shown in the centre: the target string, or the nearest note in chromatic mode. */
  targetMidi: number | null;
  /** Index of the string being measured, when there is one. */
  stringIndex: number | null;
  /** Smoothed deviation from the target, in cents. */
  cents: number | null;
  /** Smoothed pitch in Hz. */
  frequency: number | null;
  direction: Direction | null;
  /** Strings that were held in tune long enough to be checked off. */
  tuned: readonly boolean[];
}

export interface SessionOptions {
  /** MIDI notes of the strings; empty for the chromatic mode. */
  strings: readonly number[];
  mode: TunerMode;
  a4: number;
  toleranceCents: number;
}

/** Time constant of the exponential filter applied to the cents, in ms. */
const CENTS_TIME_CONSTANT_MS = 120;
/** How long a string has to spend within tolerance to count as tuned, in ms. */
export const TUNED_HOLD_MS = 1000;
/** How long it has to stay out of tolerance to lose that again, in ms. */
const UNTUNED_HOLD_MS = 500;
/**
 * Only readings this close to the target, in cents, count against a string.
 * Further away the sound is probably something else (a fretted note, another
 * string in manual mode) and says nothing about how the string is tuned.
 */
const OUT_OF_TUNE_RANGE_CENTS = 50;
/** Longest stretch of time a single reading can stand for, in ms. */
const MAX_READING_MS = 100;
/** In chromatic mode the note changes only this far from the current one, in cents. */
const CHROMATIC_HYSTERESIS_CENTS = 60;

/**
 * Decides what a detected pitch means for the current tuning: which string
 * (or note) it is compared with, how far off it is, and when a string counts
 * as tuned. Holds no reference to the DOM or to audio.
 */
export class TunerSession {
  /** Called when a string has just been checked off as tuned. */
  onTuned: (stringIndex: number) => void = () => undefined;

  private strings: readonly number[];
  private mode: TunerMode;
  private a4: number;
  private toleranceCents: number;

  private tuned: boolean[];
  private manualIndex = 0;
  private autoIndex: number | null = null;
  private chromaticMidi: number | null = null;
  private target: number | null = null;
  private countedString: number | null = null;
  private inTuneMs = 0;
  private outOfTuneMs = 0;
  private lastTimeMs: number | null = null;
  private readonly centsFilter = new ExponentialFilter(CENTS_TIME_CONSTANT_MS);
  private current: TunerView;

  constructor(options: SessionOptions) {
    this.strings = options.strings;
    this.mode = options.mode;
    this.a4 = options.a4;
    this.toleranceCents = options.toleranceCents;
    this.tuned = options.strings.map(() => false);
    this.current = this.idleView();
  }

  get view(): TunerView {
    return this.current;
  }

  get selectedString(): number {
    return this.manualIndex;
  }

  /** Switches to another tuning and clears the tuned marks. */
  setStrings(strings: readonly number[]): void {
    this.strings = strings;
    this.tuned = strings.map(() => false);
    this.manualIndex = 0;
    this.countedString = null;
    this.clearNote();
  }

  setMode(mode: TunerMode): void {
    this.mode = mode;
    this.clearNote();
  }

  /** Chooses the string that the manual mode measures against. */
  selectString(index: number): void {
    this.manualIndex = Math.min(Math.max(0, index), Math.max(0, this.strings.length - 1));
    this.clearNote();
  }

  /** Changes the calibration. Every target moves, so the tuned marks are cleared. */
  setA4(a4: number): void {
    if (a4 === this.a4) return;
    this.a4 = a4;
    this.tuned = this.strings.map(() => false);
    this.countedString = null;
    this.clearNote();
  }

  setTolerance(cents: number): void {
    this.toleranceCents = cents;
  }

  /**
   * Feeds the latest smoothed pitch (null when no note is sounding) and
   * returns what to show.
   */
  update(frequency: number | null, timeMs: number): TunerView {
    if (frequency === null) {
      if (this.current.active) this.clearNote();
      return this.current;
    }

    let stringIndex: number | null = null;
    let targetMidi: number;
    if (this.strings.length === 0) {
      targetMidi = this.chromaticTarget(frequency);
    } else {
      stringIndex =
        this.mode === 'manual'
          ? this.manualIndex
          : chooseString(frequency, this.strings, this.a4, {
              current: this.autoIndex,
              tuned: this.tuned,
            });
      this.autoIndex = stringIndex;
      targetMidi = this.strings[stringIndex]!;
    }

    const target = stringIndex ?? targetMidi;
    if (target !== this.target) {
      this.target = target;
      this.centsFilter.reset();
    }

    const elapsed = this.lastTimeMs === null ? 0 : timeMs - this.lastTimeMs;
    this.lastTimeMs = timeMs;
    const cents = this.centsFilter.update(
      centsBetween(frequency, midiToFrequency(targetMidi, this.a4)),
      elapsed,
    );

    const offBy = Math.abs(cents);
    const direction: Direction =
      offBy <= this.toleranceCents ? 'in-tune' : cents < 0 ? 'flat' : 'sharp';
    const justTuned =
      stringIndex !== null &&
      this.countReading(stringIndex, offBy, Math.min(elapsed, MAX_READING_MS));

    this.current = {
      active: true,
      targetMidi,
      stringIndex,
      cents,
      frequency,
      direction,
      tuned: this.tuned,
    };
    // Reported last, so that the listener already sees the new check in the view.
    if (justTuned) this.onTuned(stringIndex!);
    return this.current;
  }

  /**
   * Counts the time a string spends in and out of tune, and checks it off or
   * takes the check away accordingly. Both counts carry over from one pluck
   * to the next: a string whose notes die away quickly can still be checked
   * off, and the sharp attack of a pluck does not undo the rest of the note.
   *
   * @param offBy Distance from the target in cents, without its sign.
   * @returns Whether the string has just been checked off.
   */
  private countReading(stringIndex: number, offBy: number, elapsedMs: number): boolean {
    if (stringIndex !== this.countedString) {
      this.countedString = stringIndex;
      this.inTuneMs = 0;
      this.outOfTuneMs = 0;
    }

    if (offBy <= this.toleranceCents) {
      this.inTuneMs += elapsedMs;
      this.outOfTuneMs = 0;
      if (this.tuned[stringIndex] || this.inTuneMs < TUNED_HOLD_MS) return false;
      this.setTuned(stringIndex, true);
      return true;
    }

    if (offBy <= OUT_OF_TUNE_RANGE_CENTS) {
      this.outOfTuneMs += elapsedMs;
      if (this.outOfTuneMs >= UNTUNED_HOLD_MS) {
        this.inTuneMs = 0;
        if (this.tuned[stringIndex]) this.setTuned(stringIndex, false);
      }
    }
    return false;
  }

  /** Views keep the list they were built with, so a change makes a new one. */
  private setTuned(stringIndex: number, tuned: boolean): void {
    this.tuned = this.tuned.map((value, i) => (i === stringIndex ? tuned : value));
  }

  private chromaticTarget(frequency: number): number {
    if (this.chromaticMidi !== null) {
      const fromCurrent = centsBetween(frequency, midiToFrequency(this.chromaticMidi, this.a4));
      if (Math.abs(fromCurrent) <= CHROMATIC_HYSTERESIS_CENTS) return this.chromaticMidi;
    }
    this.chromaticMidi = nearestNote(frequency, this.a4).midi;
    return this.chromaticMidi;
  }

  private clearNote(): void {
    this.autoIndex = null;
    this.chromaticMidi = null;
    this.target = null;
    this.lastTimeMs = null;
    this.centsFilter.reset();
    this.current = this.idleView();
  }

  /** With no note sounding, the manual mode still shows the string it is waiting for. */
  private idleView(): TunerView {
    const manual = this.mode === 'manual' && this.strings.length > 0;
    return {
      active: false,
      targetMidi: manual ? this.strings[this.manualIndex]! : null,
      stringIndex: manual ? this.manualIndex : null,
      cents: null,
      frequency: null,
      direction: null,
      tuned: this.tuned,
    };
  }
}
