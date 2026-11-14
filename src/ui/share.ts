import { encode } from 'uqr';

const SHARE_TITLE = 'Pluck Tuner';
const SHARE_TEXT = 'A tuner for guitar, bass, ukulele and more that runs in the browser.';

/** Address of the app itself, without query string or hash. */
export function appUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/** Whether the system share sheet can be used for the app link. */
export function canShareNatively(): boolean {
  return typeof navigator.share === 'function';
}

/**
 * Opens the system share sheet.
 *
 * @returns 'shared' on success, 'cancelled' when the user closed the sheet,
 *          'unavailable' when sharing is not possible here.
 */
export async function shareNatively(): Promise<'shared' | 'cancelled' | 'unavailable'> {
  if (!canShareNatively()) return 'unavailable';
  try {
    await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: appUrl() });
    return 'shared';
  } catch (error) {
    return error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'unavailable';
  }
}

/** Copies the app link to the clipboard. Returns whether it worked. */
export async function copyLink(): Promise<boolean> {
  const url = appUrl();
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Clipboard API missing or blocked: fall back to a temporary text field.
    const field = document.createElement('textarea');
    field.value = url;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    field.remove();
    return copied;
  }
}

/**
 * Draws a QR code for `text` into `container` as an inline SVG. The code is
 * generated in the browser; nothing is requested from the network.
 */
export function renderQrCode(container: HTMLElement, text: string): void {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y]?.[x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  container.innerHTML =
    `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code with the link to this app" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#0e1014"/></svg>`;
}

/** Whether this looks like a desktop: a precise pointer and no touch-first input. */
export function isDesktop(): boolean {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
