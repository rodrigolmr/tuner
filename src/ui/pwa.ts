import { registerSW } from 'virtual:pwa-register';

export interface PwaCallbacks {
  /** A new version was downloaded; call `apply` to switch to it. */
  onUpdateAvailable(apply: () => void): void;
  /** The app was cached and now works without a connection. */
  onOfflineReady(): void;
}

/** How often an open app looks for a new version, in milliseconds. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the service worker. A new version is never activated behind the
 * user's back: it waits until they press "Update".
 */
export function setupPwa(callbacks: PwaCallbacks): void {
  const updateServiceWorker = registerSW({
    onNeedRefresh() {
      callbacks.onUpdateAvailable(() => void updateServiceWorker(true));
    },
    onOfflineReady() {
      callbacks.onOfflineReady();
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => undefined);
      };
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}
