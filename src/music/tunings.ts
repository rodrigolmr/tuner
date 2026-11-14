import { midiToFrequency, parseNote } from './notes';

export interface Tuning {
  id: string;
  name: string;
  /** MIDI note of every string, from the lowest course to the highest. */
  strings: number[];
}

export interface Instrument {
  id: string;
  name: string;
  /** Strings per course: 2 when every string of a pair is listed separately. */
  stringsPerCourse: number;
  /** Extra guidance shown under the string list. */
  hint?: string;
  /** Empty for the chromatic mode, which has no target strings. */
  tunings: Tuning[];
}

/** Lowest and highest frequency the tuner tries to detect, in Hz. */
export const DETECTION_MIN_HZ = 27;
export const DETECTION_MAX_HZ = 2000;

export const CHROMATIC_ID = 'chromatic';
export const DEFAULT_INSTRUMENT_ID = 'guitar';

function tuning(id: string, name: string, notes: string): Tuning {
  return { id, name, strings: notes.split(/\s+/).map(parseNote) };
}

export const INSTRUMENTS: readonly Instrument[] = [
  {
    id: 'guitar',
    name: 'Guitar',
    stringsPerCourse: 1,
    tunings: [
      tuning('standard', 'Standard', 'E2 A2 D3 G3 B3 E4'),
      tuning('half-step-down', 'Half step down', 'D#2 G#2 C#3 F#3 A#3 D#4'),
      tuning('whole-step-down', 'Whole step down', 'D2 G2 C3 F3 A3 D4'),
      tuning('drop-d', 'Drop D', 'D2 A2 D3 G3 B3 E4'),
      tuning('dadgad', 'DADGAD', 'D2 A2 D3 G3 A3 D4'),
      tuning('open-g', 'Open G', 'D2 G2 D3 G3 B3 D4'),
      tuning('open-d', 'Open D', 'D2 A2 D3 F#3 A3 D4'),
    ],
  },
  {
    id: 'bass-4',
    name: 'Bass (4-string)',
    stringsPerCourse: 1,
    tunings: [
      tuning('standard', 'Standard', 'E1 A1 D2 G2'),
      tuning('half-step-down', 'Half step down', 'D#1 G#1 C#2 F#2'),
    ],
  },
  {
    id: 'bass-5',
    name: 'Bass (5-string)',
    stringsPerCourse: 1,
    tunings: [
      tuning('standard', 'Standard', 'B0 E1 A1 D2 G2'),
      tuning('half-step-down', 'Half step down', 'A#0 D#1 G#1 C#2 F#2'),
    ],
  },
  {
    id: 'ukulele',
    name: 'Ukulele',
    stringsPerCourse: 1,
    tunings: [
      tuning('standard', 'Standard (high G)', 'G4 C4 E4 A4'),
      tuning('low-g', 'Low G', 'G3 C4 E4 A4'),
    ],
  },
  {
    id: 'cavaquinho',
    name: 'Cavaquinho',
    stringsPerCourse: 1,
    tunings: [
      tuning('dgbd', 'Standard (D G B D)', 'D4 G4 B4 D5'),
      tuning('dgbe', 'D G B E', 'D4 G4 B4 E5'),
    ],
  },
  {
    id: 'mandolin',
    name: 'Mandolin',
    stringsPerCourse: 1,
    hint: 'Paired strings: tune both strings of each pair to the same note.',
    tunings: [tuning('standard', 'Standard', 'G3 D4 A4 E5')],
  },
  {
    id: 'viola-caipira',
    name: 'Viola caipira',
    stringsPerCourse: 2,
    hint: 'Pairs 5 to 1, left to right. Pairs 5, 4 and 3 are tuned in octaves; pairs 2 and 1 in unison.',
    tunings: [
      tuning('cebolao-d', 'Cebolão in D', 'A2 A3 D3 D4 F#3 F#4 A3 A3 D4 D4'),
      tuning('cebolao-e', 'Cebolão in E', 'B2 B3 E3 E4 G#3 G#4 B3 B3 E4 E4'),
      tuning('rio-abaixo', 'Rio Abaixo', 'G2 G3 D3 D4 G3 G4 B3 B3 D4 D4'),
    ],
  },
  {
    id: CHROMATIC_ID,
    name: 'Chromatic',
    stringsPerCourse: 1,
    tunings: [],
  },
];

export function findInstrument(id: string): Instrument {
  return (
    INSTRUMENTS.find((instrument) => instrument.id === id) ??
    INSTRUMENTS.find((instrument) => instrument.id === DEFAULT_INSTRUMENT_ID)!
  );
}

/** Returns the tuning with the given id, or the instrument's first tuning. */
export function findTuning(instrument: Instrument, id: string): Tuning | null {
  return instrument.tunings.find((t) => t.id === id) ?? instrument.tunings[0] ?? null;
}

export interface FrequencyRange {
  minFreq: number;
  maxFreq: number;
}

/** Semitones of headroom kept below the lowest and above the highest string. */
const RANGE_MARGIN_BELOW = 5;
const RANGE_MARGIN_ABOVE = 7;

/**
 * Frequency range the detector has to cover for a set of strings. The margins
 * leave room for strings that are still far from their target; an empty list
 * (chromatic mode) covers the full range.
 */
export function detectionRange(strings: readonly number[], a4: number): FrequencyRange {
  if (strings.length === 0) {
    return { minFreq: DETECTION_MIN_HZ, maxFreq: DETECTION_MAX_HZ };
  }
  const lowest = midiToFrequency(Math.min(...strings) - RANGE_MARGIN_BELOW, a4);
  const highest = midiToFrequency(Math.max(...strings) + RANGE_MARGIN_ABOVE, a4);
  return {
    minFreq: Math.max(DETECTION_MIN_HZ, lowest),
    maxFreq: Math.min(DETECTION_MAX_HZ, highest),
  };
}
