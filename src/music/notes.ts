/** MIDI note number of A4, the calibration reference. */
export const A4_MIDI = 69;
export const DEFAULT_A4 = 440;
export const MIN_A4 = 430;
export const MAX_A4 = 450;

export type Notation = 'letters' | 'solfege';
export type Accidental = 'sharp' | 'flat';

export interface NoteNameOptions {
  notation: Notation;
  accidental: Accidental;
}

export interface NoteLabel {
  /** Name without the accidental, e.g. "C" or "Do". */
  base: string;
  /** "♯", "♭" or an empty string. */
  accidental: string;
  /** Scientific pitch octave (A4 = 440 Hz is in octave 4). */
  octave: number;
  /** Full label, e.g. "C♯4". */
  text: string;
}

export interface NearestNote {
  midi: number;
  /** Deviation from the nearest note, in cents (-50..+50). */
  cents: number;
  /** Frequency of the nearest note in Hz. */
  frequency: number;
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SOLFEGE = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
/** Semitone offset of each natural note from C. */
const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/** For each pitch class: [natural index, accidental] when spelled with sharps. */
const SHARP_SPELLING: ReadonlyArray<readonly [number, string]> = [
  [0, ''], [0, '♯'], [1, ''], [1, '♯'], [2, ''], [3, ''],
  [3, '♯'], [4, ''], [4, '♯'], [5, ''], [5, '♯'], [6, ''],
];
/** For each pitch class: [natural index, accidental] when spelled with flats. */
const FLAT_SPELLING: ReadonlyArray<readonly [number, string]> = [
  [0, ''], [1, '♭'], [1, ''], [2, '♭'], [2, ''], [3, ''],
  [4, '♭'], [4, ''], [5, '♭'], [5, ''], [6, '♭'], [6, ''],
];

export function midiToFrequency(midi: number, a4: number = DEFAULT_A4): number {
  return a4 * 2 ** ((midi - A4_MIDI) / 12);
}

/** Fractional MIDI note number for a frequency. */
export function frequencyToMidi(frequency: number, a4: number = DEFAULT_A4): number {
  return A4_MIDI + 12 * Math.log2(frequency / a4);
}

/** Signed distance from `reference` to `frequency` in cents. */
export function centsBetween(frequency: number, reference: number): number {
  return 1200 * Math.log2(frequency / reference);
}

export function nearestNote(frequency: number, a4: number = DEFAULT_A4): NearestNote {
  const exact = frequencyToMidi(frequency, a4);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100, frequency: midiToFrequency(midi, a4) };
}

/** Parses scientific pitch notation such as "A#0", "Bb3" or "E5" into a MIDI note number. */
export function parseNote(name: string): number {
  const match = /^([A-Ga-g])([#b♯♭]?)(-?\d+)$/.exec(name.trim());
  if (!match) throw new Error(`Invalid note name: "${name}"`);
  const natural = LETTERS.indexOf(match[1]!.toUpperCase());
  const accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] ? -1 : 0;
  const octave = Number(match[3]);
  return (octave + 1) * 12 + NATURAL_SEMITONES[natural]! + accidental;
}

export function noteLabel(midi: number, options: NoteNameOptions): NoteLabel {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const spelling = options.accidental === 'flat' ? FLAT_SPELLING : SHARP_SPELLING;
  const [natural, accidental] = spelling[pitchClass]!;
  const base = (options.notation === 'solfege' ? SOLFEGE : LETTERS)[natural]!;
  return { base, accidental, octave, text: `${base}${accidental}${octave}` };
}
