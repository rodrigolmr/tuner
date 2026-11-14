import { byId, openDialog, showToast } from './dom';
import {
  appUrl,
  canShareNatively,
  copyLink,
  isDesktop,
  renderQrCode,
  shareNatively,
} from './share';

async function copyAndReport(): Promise<void> {
  showToast((await copyLink()) ? 'Link copied' : 'Could not copy the link');
}

/**
 * Wires the Share button. Phones get the system share sheet (or a copied
 * link when the Web Share API is missing); desktops get a dialog with a QR
 * code to open the app on a phone.
 */
export function setupShare(): void {
  const url = appUrl();
  const dialog = byId<HTMLDialogElement>('share-dialog');
  const nativeButton = byId<HTMLButtonElement>('native-share-button');

  const showDialog = (): void => {
    renderQrCode(byId('share-qr'), url);
    byId('share-url').textContent = url;
    nativeButton.hidden = !canShareNatively();
    openDialog(dialog);
  };

  byId('share-button').addEventListener('click', async () => {
    if (isDesktop()) {
      showDialog();
    } else if ((await shareNatively()) === 'unavailable') {
      await copyAndReport();
    }
  });
  byId('copy-link-button').addEventListener('click', () => void copyAndReport());
  nativeButton.addEventListener('click', () => void shareNatively());

  if (isDesktop()) {
    renderQrCode(byId('phone-qr'), url);
    byId('phone-card').hidden = false;
  }
}
