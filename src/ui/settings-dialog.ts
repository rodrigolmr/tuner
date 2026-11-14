import { type Accidental, DEFAULT_A4, MAX_A4, MIN_A4, type Notation } from '../music/notes';
import { byId, openDialog, segmented } from './dom';
import { SENSITIVITY_LABELS, type Settings } from './settings';

export interface SettingsDialog {
  open(): void;
}

/**
 * Wires the settings sheet. Every change is reported right away through
 * `onChange`; there is no separate "save" step.
 */
export function setupSettingsDialog(
  settings: Readonly<Settings>,
  onChange: (patch: Partial<Settings>) => void,
): SettingsDialog {
  const dialog = byId<HTMLDialogElement>('settings-dialog');
  const a4Range = byId<HTMLInputElement>('a4-range');
  const a4Value = byId('a4-value');
  const toleranceRange = byId<HTMLInputElement>('tolerance-range');
  const toleranceValue = byId('tolerance-value');
  const sensitivityRange = byId<HTMLInputElement>('sensitivity-range');
  const sensitivityValue = byId('sensitivity-value');

  let a4 = settings.a4;
  const setA4 = (value: number, notify: boolean): void => {
    a4 = Math.min(MAX_A4, Math.max(MIN_A4, Math.round(value)));
    a4Range.value = String(a4);
    a4Value.textContent = `${a4} Hz`;
    if (notify) onChange({ a4 });
  };
  a4Range.min = String(MIN_A4);
  a4Range.max = String(MAX_A4);
  a4Range.addEventListener('input', () => setA4(a4Range.valueAsNumber, true));
  byId('a4-down').addEventListener('click', () => setA4(a4 - 1, true));
  byId('a4-up').addEventListener('click', () => setA4(a4 + 1, true));
  byId('a4-reset').addEventListener('click', () => setA4(DEFAULT_A4, true));
  setA4(settings.a4, false);

  const pressNotation = segmented<Notation>(byId('notation-toggle'), 'value', (notation) => {
    pressNotation(notation);
    onChange({ notation });
  });
  pressNotation(settings.notation);

  const pressAccidental = segmented<Accidental>(byId('accidental-toggle'), 'value', (accidental) => {
    pressAccidental(accidental);
    onChange({ accidental });
  });
  pressAccidental(settings.accidental);

  const showTolerance = (cents: number): void => {
    toleranceValue.textContent = `±${cents} ${cents === 1 ? 'cent' : 'cents'}`;
  };
  toleranceRange.value = String(settings.toleranceCents);
  showTolerance(settings.toleranceCents);
  toleranceRange.addEventListener('input', () => {
    showTolerance(toleranceRange.valueAsNumber);
    onChange({ toleranceCents: toleranceRange.valueAsNumber });
  });

  const showSensitivity = (level: number): void => {
    sensitivityValue.textContent = SENSITIVITY_LABELS[level - 1] ?? '';
  };
  sensitivityRange.value = String(settings.sensitivity);
  showSensitivity(settings.sensitivity);
  sensitivityRange.addEventListener('input', () => {
    showSensitivity(sensitivityRange.valueAsNumber);
    onChange({ sensitivity: sensitivityRange.valueAsNumber });
  });

  byId('about').textContent =
    `Pluck Tuner ${__APP_VERSION__}. Works offline. No accounts, no tracking: ` +
    'your settings stay in this browser and audio is analysed on this device only.';

  return { open: () => openDialog(dialog) };
}
