import './ui/styles.css';
import { TunerApp } from './ui/app';
import { byId, showToast } from './ui/dom';
import { setupPwa } from './ui/pwa';
import { setupShare } from './ui/share-dialog';

new TunerApp();
setupShare();

setupPwa({
  onUpdateAvailable(apply) {
    const button = byId<HTMLButtonElement>('update-button');
    byId('update-banner').hidden = false;
    button.addEventListener(
      'click',
      () => {
        button.disabled = true;
        apply();
      },
      { once: true },
    );
  },
  onOfflineReady() {
    showToast('Ready to work offline');
  },
});
