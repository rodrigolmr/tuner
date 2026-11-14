import { centsBetween, midiToFrequency } from './notes';

/**
 * How much closer (in cents) another string has to be before the automatic
 * mode leaves the current string. Avoids flickering between two strings when
 * the pitch sits halfway between them.
 */
export const SWITCH_HYSTERESIS_CENTS = 20;

export interface StringChoiceState {
  /** String chosen for the previous reading, if any. */
  current?: number | null;
  /** Which strings are already marked as tuned. */
  tuned?: readonly boolean[];
}

function distancesInCents(frequency: number, strings: readonly number[], a4: number): number[] {
  return strings.map((midi) => Math.abs(centsBetween(frequency, midiToFrequency(midi, a4))));
}

/**
 * Index of the string whose target pitch is closest to `frequency`.
 * The distance is measured in cents, never by note name, so that the same
 * note in another octave is treated as a different string. Returns -1 when
 * there are no strings. Ties go to the first string.
 */
export function nearestStringIndex(
  frequency: number,
  strings: readonly number[],
  a4: number,
): number {
  const distances = distancesInCents(frequency, strings, a4);
  let best = -1;
  for (let i = 0; i < distances.length; i++) {
    if (best < 0 || distances[i]! < distances[best]!) best = i;
  }
  return best;
}

/**
 * String choice for the automatic mode: the nearest string in cents, with
 * hysteresis around the current one. Strings that share the same pitch
 * (unison pairs) cannot be told apart by ear or by microphone, so the current
 * one is kept while it matches, and otherwise the first one that is not tuned
 * yet is preferred.
 */
export function chooseString(
  frequency: number,
  strings: readonly number[],
  a4: number,
  state: StringChoiceState = {},
): number {
  const distances = distancesInCents(frequency, strings, a4);
  let best = -1;
  for (let i = 0; i < distances.length; i++) {
    if (best < 0 || distances[i]! < distances[best]!) best = i;
  }
  if (best < 0) return -1;

  const current = state.current ?? null;
  if (current !== null && current >= 0 && current < strings.length) {
    if (distances[current]! - distances[best]! <= SWITCH_HYSTERESIS_CENTS) return current;
  }

  const tuned = state.tuned ?? [];
  for (let i = 0; i < strings.length; i++) {
    if (strings[i] === strings[best] && !tuned[i]) return i;
  }
  return best;
}
