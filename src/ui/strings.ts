import type { NoteLabel } from '../music/notes';

export interface StringListCallbacks {
  /** The user tapped a string to tune against it. */
  onSelect(index: number): void;
  /** The user asked for the reference tone of a string. */
  onPlay(index: number): void;
}

/** What the list shows for one string of the tuning. */
export interface StringInfo {
  label: NoteLabel;
  /** Number of the string (or of its course), as musicians count them. */
  number: number;
  /** Relative thickness, from 0 for the thinnest string to 1 for the thickest. */
  gauge: number;
}

export interface StringListState {
  /** String being measured right now, if any. */
  activeIndex: number | null;
  /** String chosen in manual mode, if that mode is on. */
  selectedIndex: number | null;
  tuned: readonly boolean[];
  /** String whose reference tone is playing, if any. */
  playingIndex: number | null;
  /** Whether the active string is within tolerance. */
  inTune: boolean;
  /** How much of the in-tune hold the active string has completed, from 0 to 1. */
  holdProgress: number;
}

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SPEAKER_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const STOP_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';

interface StringElements {
  root: HTMLElement;
  select: HTMLButtonElement;
  tone: HTMLButtonElement;
  /** Spoken name, e.g. "6, E2". */
  name: string;
  /** Note alone, e.g. "E2". */
  note: string;
  /** Last value written to the --progress property. */
  progress: string;
}

function flag(element: HTMLElement, name: string, on: boolean): void {
  if (on) element.dataset[name] = 'true';
  else delete element.dataset[name];
}

/** The row (or grid) of strings of the current tuning. */
export class StringList {
  private items: StringElements[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: StringListCallbacks,
  ) {}

  /**
   * Rebuilds the list for a tuning.
   *
   * @param strings Every string of the tuning, lowest course first.
   * @param stringsPerCourse Strings stacked in each column (2 for paired courses).
   */
  setStrings(strings: readonly StringInfo[], stringsPerCourse: number): void {
    const columns = Math.max(1, Math.ceil(strings.length / stringsPerCourse));
    this.container.style.setProperty('--columns', String(columns));
    this.container.style.setProperty('--rows', String(stringsPerCourse));

    this.items = strings.map(({ label, number, gauge }, index) => {
      const root = document.createElement('div');
      root.className = 'string';
      root.style.setProperty('--gauge', gauge.toFixed(3));

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'string-select';
      select.dataset.testid = `string-${index}`;
      const ordinal = document.createElement('span');
      ordinal.className = 'string-number';
      ordinal.textContent = String(number);
      const note = document.createElement('span');
      note.className = 'string-note';
      note.textContent = `${label.base}${label.accidental}`;
      const octave = document.createElement('sub');
      octave.textContent = String(label.octave);
      note.append(octave);
      // A dash as thick as the string is, next to the others.
      const thickness = document.createElement('span');
      thickness.className = 'string-gauge';
      const check = document.createElement('span');
      check.className = 'string-check';
      check.innerHTML = CHECK_ICON;
      select.append(ordinal, note, thickness, check);
      select.addEventListener('click', () => this.callbacks.onSelect(index));

      const tone = document.createElement('button');
      tone.type = 'button';
      tone.className = 'string-tone';
      tone.innerHTML = SPEAKER_ICON;
      tone.addEventListener('click', () => this.callbacks.onPlay(index));

      root.append(select, tone);
      return { root, select, tone, name: `${number}, ${label.text}`, note: label.text, progress: '' };
    });
    this.container.replaceChildren(...this.items.map((item) => item.root));
  }

  render(state: StringListState): void {
    this.items.forEach((item, index) => {
      const active = state.activeIndex === index;
      const tuned = state.tuned[index] === true;
      const playing = state.playingIndex === index;
      flag(item.root, 'active', active);
      flag(item.root, 'inTune', active && state.inTune);
      flag(item.root, 'tuned', tuned);
      flag(item.root, 'selected', state.selectedIndex === index);

      // The border fills up while the string is held in tune, and stays full once checked.
      const held = active && state.inTune ? (tuned ? 1 : state.holdProgress) : 0;
      const progress = held.toFixed(3);
      if (progress !== item.progress) {
        item.progress = progress;
        item.root.style.setProperty('--progress', progress);
      }

      const description = `${item.name}${tuned ? ', in tune' : ''}`;
      item.select.setAttribute('aria-label', `Tune string ${description}`);
      item.select.setAttribute('aria-pressed', String(state.selectedIndex === index));

      if (item.root.dataset.playing !== (playing ? 'true' : undefined)) {
        flag(item.root, 'playing', playing);
        item.tone.innerHTML = playing ? STOP_ICON : SPEAKER_ICON;
      }
      item.tone.setAttribute(
        'aria-label',
        playing ? `Stop the ${item.note} reference tone` : `Play the ${item.note} reference tone`,
      );
    });
  }
}
