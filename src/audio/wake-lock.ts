/**
 * Keeps the screen on through the Screen Wake Lock API. Browsers without the
 * API (or that refuse the request, for example in battery saver mode) simply
 * let the screen dim as usual.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  get supported(): boolean {
    return 'wakeLock' in navigator;
  }

  get active(): boolean {
    return this.sentinel !== null;
  }

  async enable(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    try {
      await sentinel?.release();
    } catch {
      // Already released.
    }
  }

  /**
   * The browser releases the lock whenever the page is hidden. Call this
   * when it becomes visible again to take the lock back.
   */
  async reacquire(): Promise<void> {
    if (this.wanted && !this.sentinel) await this.acquire();
  }

  private async acquire(): Promise<void> {
    if (!this.supported || this.sentinel || document.visibilityState !== 'visible') return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
      if (this.wanted) {
        this.sentinel = sentinel;
      } else {
        await sentinel.release();
      }
    } catch {
      // Denied or unsupported in this context: nothing to do.
    }
  }
}
