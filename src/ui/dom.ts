/** Looks up an element that is part of the static page and must exist. */
export function byId<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as unknown as T;
}

/**
 * Wires a segmented control: a group of buttons carrying `data-<key>` values
 * of which exactly one is pressed.
 *
 * @returns A function that marks the button for a value as pressed.
 */
export function segmented<T extends string>(
  group: HTMLElement,
  key: string,
  onPick: (value: T) => void,
): (value: T) => void {
  const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>(`button[data-${key}]`));
  for (const button of buttons) {
    button.addEventListener('click', () => onPick(button.dataset[key] as T));
  }
  return (value) => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset[key] === value));
    }
  };
}

/** Opens a <dialog> as a modal and closes it when the backdrop is clicked. */
export function openDialog(dialog: HTMLDialogElement): void {
  if (!dialog.dataset.wired) {
    dialog.dataset.wired = 'true';
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
  if (!dialog.open) dialog.showModal();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message at the bottom of the screen. */
export function showToast(message: string, durationMs = 2800): void {
  const toast = byId('toast');
  toast.textContent = message;
  toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => delete toast.dataset.visible, durationMs);
}
