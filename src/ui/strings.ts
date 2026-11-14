import type { NoteLabel } from '../music/notes';

export interface StringListCallbacks {
  /** The user tapped a string to tune against it. */
  onSelect(index: number): void;
  /** The user asked for the reference tone of a string. */
  onPlay(index: number): void;
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
  label: string;
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
   * @param labels Note label of every string, lowest course first.
   * @param stringsPerCourse Strings stacked in each column (2 for paired courses).
   */
  setStrings(labels: readonly NoteLabel[], stringsPerCourse: number): void {
    const columns = Math.max(1, Math.ceil(labels.length / stringsPerCourse));
    this.container.style.setProperty('--columns', String(columns));
    this.container.style.setProperty('--rows', String(stringsPerCourse));

    this.items = labels.map((label, index) => {
      const root = document.createElement('div');
      root.className = 'string';

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'string-select';
      select.dataset.testid = `string-${index}`;
      const note = document.createElement('span');
      note.className = 'string-note';
      note.textContent = `${label.base}${label.accidental}`;
      const octave = document.createElement('sub');
      octave.textContent = String(label.octave);
      note.append(octave);
      const check = document.createElement('span');
      check.className = 'string-check';
      check.innerHTML = CHECK_ICON;
      select.append(note, check);
      select.addEventListener('click', () => this.callbacks.onSelect(index));

      const tone = document.createElement('button');
      tone.type = 'button';
      tone.className = 'string-tone';
      tone.innerHTML = SPEAKER_ICON;
      tone.addEventListener('click', () => this.callbacks.onPlay(index));

      root.append(select, tone);
      return { root, select, tone, label: label.text };
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

      const description = `${item.label}${tuned ? ', in tune' : ''}`;
      item.select.setAttribute('aria-label', `Tune string ${description}`);
      item.select.setAttribute('aria-pressed', String(state.selectedIndex === index));

      if (item.root.dataset.playing !== (playing ? 'true' : undefined)) {
        flag(item.root, 'playing', playing);
        item.tone.innerHTML = playing ? STOP_ICON : SPEAKER_ICON;
      }
      item.tone.setAttribute(
        'aria-label',
        playing ? `Stop the ${item.label} reference tone` : `Play the ${item.label} reference tone`,
      );
    });
  }
}
