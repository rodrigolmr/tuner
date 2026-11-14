import {
  type Accidental,
  DEFAULT_A4,
  MAX_A4,
  MIN_A4,
  type Notation,
} from '../music/notes';
import { DEFAULT_INSTRUMENT_ID, INSTRUMENTS } from '../music/tunings';

export type TunerMode = 'auto' | 'manual';

export interface Settings {
  /** Frequency of A4 in Hz. */
  a4: number;
  notation: Notation;
  accidental: Accidental;
  /** A string counts as in tune within this many cents of its target. */
  toleranceCents: number;
  /** Microphone sensitivity from 1 (least sensitive) to 5 (most sensitive). */
  sensitivity: number;
  instrumentId: string;
  /** Last tuning chosen for each instrument, by instrument id. */
  tuningIds: Record<string, string>;
  mode: TunerMode;
}

export const MIN_TOLERANCE = 1;
export const MAX_TOLERANCE = 10;
export const MIN_SENSITIVITY = 1;
export const MAX_SENSITIVITY = 5;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  a4: DEFAULT_A4,
  notation: 'letters',
  accidental: 'sharp',
  toleranceCents: 3,
  sensitivity: 3,
  instrumentId: DEFAULT_INSTRUMENT_ID,
  tuningIds: {},
  mode: 'auto',
};

/** How far above the noise floor a note has to be, per sensitivity level, in dB. */
const GATE_DB_BY_SENSITIVITY = [20, 16, 12, 9, 6];
export const SENSITIVITY_LABELS = ['Lowest', 'Low', 'Medium', 'High', 'Highest'];

export function gateDbForSensitivity(sensitivity: number): number {
  return GATE_DB_BY_SENSITIVITY[sensitivity - 1] ?? GATE_DB_BY_SENSITIVITY[2]!;
}

const STORAGE_KEY = 'pluck.settings.v1';

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

/** Builds valid settings from whatever was stored, falling back to the defaults. */
export function sanitizeSettings(stored: unknown): Settings {
  const source = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const defaults = DEFAULT_SETTINGS;

  const tuningIds: Record<string, string> = {};
  if (source.tuningIds && typeof source.tuningIds === 'object') {
    for (const [instrumentId, tuningId] of Object.entries(source.tuningIds)) {
      const instrument = INSTRUMENTS.find((candidate) => candidate.id === instrumentId);
      if (instrument?.tunings.some((tuning) => tuning.id === tuningId)) {
        tuningIds[instrumentId] = tuningId as string;
      }
    }
  }

  return {
    a4: clampInteger(source.a4, MIN_A4, MAX_A4, defaults.a4),
    notation: source.notation === 'solfege' ? 'solfege' : defaults.notation,
    accidental: source.accidental === 'flat' ? 'flat' : defaults.accidental,
    toleranceCents: clampInteger(
      source.toleranceCents,
      MIN_TOLERANCE,
      MAX_TOLERANCE,
      defaults.toleranceCents,
    ),
    sensitivity: clampInteger(
      source.sensitivity,
      MIN_SENSITIVITY,
      MAX_SENSITIVITY,
      defaults.sensitivity,
    ),
    instrumentId: INSTRUMENTS.some((instrument) => instrument.id === source.instrumentId)
      ? (source.instrumentId as string)
      : defaults.instrumentId,
    tuningIds,
    mode: source.mode === 'manual' ? 'manual' : defaults.mode,
  };
}

/** Reads the settings from localStorage; never throws. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeSettings(null);
  }
}

/** Writes the settings to localStorage; silently does nothing when storage is unavailable. */
export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota: the settings just do not persist.
  }
}
