let context: AudioContext | null = null;

/** How long to wait for the browser to start the audio clock. */
const RESUME_TIMEOUT_MS = 1500;

/**
 * The single AudioContext shared by the microphone and the reference tone.
 * It is created lazily because browsers only allow audio to start after a
 * user gesture. The sample rate is left to the device (48 kHz on most
 * Android phones) and always read back from `context.sampleRate`.
 */
export function getAudioContext(): AudioContext {
  if (!context) {
    const Constructor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    context = new Constructor({ latencyHint: 'interactive' });
  }
  return context;
}

/** The shared context if it already exists; never creates one. */
export function peekAudioContext(): AudioContext | null {
  return context;
}

/**
 * Asks the browser to run the shared context and reports whether it is
 * running. Without a user gesture, `resume()` may stay pending forever, so
 * the wait is bounded.
 */
export async function resumeAudioContext(): Promise<boolean> {
  const audio = getAudioContext();
  // Read through a function: the state changes while this function awaits.
  const isRunning = (): boolean => audio.state === 'running';
  if (isRunning()) return true;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS));
  try {
    await Promise.race([audio.resume(), timeout]);
  } catch {
    // Not allowed yet: the caller falls back to asking for a tap.
  }
  return isRunning();
}
