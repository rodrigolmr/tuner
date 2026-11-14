import processorUrl from './capture-processor.ts?worker&url';
import { getAudioContext, resumeAudioContext } from './context';

export type MicrophoneErrorKind =
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'insecure'
  | 'unsupported'
  | 'unknown';

export class MicrophoneError extends Error {
  readonly kind: MicrophoneErrorKind;

  constructor(kind: MicrophoneErrorKind, cause?: unknown) {
    super(`Microphone unavailable: ${kind}`, { cause });
    this.name = 'MicrophoneError';
    this.kind = kind;
  }
}

/**
 * - idle: not capturing; a user gesture is needed to start.
 * - starting: waiting for permission and for the audio graph.
 * - running: audio is flowing.
 * - interrupted: capture was started but the browser paused it (page in the
 *   background, screen locked, another app took the audio focus).
 */
export type MicrophoneState = 'idle' | 'starting' | 'running' | 'interrupted';

export interface MicrophoneCallbacks {
  /**
   * New audio from the microphone. When `replace` is true, `samples` is the
   * complete most recent audio instead of a continuation of the last call.
   */
  onSamples(samples: Float32Array, replace: boolean): void;
  onStateChange(state: MicrophoneState): void;
}

export interface MicrophoneInfo {
  sampleRate: number | null;
  contextState: string;
  capture: 'worklet' | 'analyser' | 'none';
  trackLabel: string;
  trackState: string;
  /** Processing the browser actually applied, which may differ from the request. */
  settings: MediaTrackSettings | null;
}

/** Interval of the AnalyserNode fallback, in milliseconds. */
const POLL_INTERVAL_MS = 25;
/** Capture counts as stalled when no audio arrives for this long. */
const STALL_MS = 2500;
const WATCHDOG_INTERVAL_MS = 1000;
const MAX_RECOVERY_ATTEMPTS = 3;

function toMicrophoneError(error: unknown): MicrophoneError {
  if (error instanceof MicrophoneError) return error;
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new MicrophoneError('denied', error);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new MicrophoneError('not-found', error);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new MicrophoneError('in-use', error);
    default:
      return new MicrophoneError('unknown', error);
  }
}

/**
 * Microphone capture. The signal goes through a high-pass filter (to drop
 * DC offset and handling rumble) into an AudioWorklet that forwards raw
 * samples to the main thread. Browsers without AudioWorklet fall back to an
 * AnalyserNode that is polled for the latest audio.
 */
export class Microphone {
  state: MicrophoneState = 'idle';

  private readonly callbacks: MicrophoneCallbacks;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private highPass: BiquadFilterNode | null = null;
  private highPassHz = 20;
  private capture: MicrophoneInfo['capture'] = 'none';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private workletModule: Promise<void> | null = null;
  private listeningToContext = false;
  private lastSamplesAt = 0;
  private recoveryAttempts = 0;

  constructor(callbacks: MicrophoneCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Asks for the microphone and starts capturing. Has to be called from a
   * user gesture (a tap or click) the first time.
   *
   * @throws MicrophoneError when the microphone cannot be used.
   */
  async start(): Promise<void> {
    if (this.state === 'starting') return;
    this.setState('starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new MicrophoneError(window.isSecureContext ? 'unsupported' : 'insecure');
      }
      const audio = getAudioContext();
      // Started before any await so that it still counts as part of the gesture.
      const resuming = resumeAudioContext();
      this.release();
      this.stream = await this.openStream();
      await resuming;
      await this.connect(audio, this.stream);
      this.watch(audio, this.stream);
      this.lastSamplesAt = performance.now();
      this.setState(audio.state === 'running' ? 'running' : 'interrupted');
    } catch (error) {
      this.release();
      this.setState('idle');
      throw toMicrophoneError(error);
    }
  }

  /** Stops capturing and releases the microphone. */
  stop(): void {
    this.release();
    this.setState('idle');
  }

  /** Pauses audio processing while the page is hidden. */
  suspend(): void {
    if (this.state !== 'running') return;
    void getAudioContext()
      .suspend()
      .catch(() => undefined);
  }

  /**
   * Brings capture back after the page returns to the foreground or the
   * screen is unlocked. Reopens the microphone if the browser closed it.
   *
   * @returns Whether audio is flowing again.
   */
  async resume(): Promise<boolean> {
    if (this.state === 'idle' || this.state === 'starting') return false;
    const track = this.stream?.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') {
      try {
        await this.start();
      } catch {
        return false;
      }
      return this.state === 'running';
    }
    const running = await resumeAudioContext();
    this.lastSamplesAt = performance.now();
    this.setState(running ? 'running' : 'interrupted');
    return running;
  }

  /** Cutoff of the input high-pass filter, in Hz. */
  setHighPass(frequency: number): void {
    this.highPassHz = frequency;
    if (this.highPass) this.highPass.frequency.value = frequency;
  }

  /** Details for the diagnostics panel. */
  get info(): MicrophoneInfo {
    const track = this.stream?.getAudioTracks()[0];
    const audio = this.stream ? getAudioContext() : null;
    return {
      sampleRate: audio?.sampleRate ?? null,
      contextState: audio?.state ?? 'none',
      capture: this.capture,
      trackLabel: track?.label ?? '',
      trackState: track ? `${track.readyState}${track.muted ? ', muted' : ''}` : 'none',
      settings: track?.getSettings?.() ?? null,
    };
  }

  private async openStream(): Promise<MediaStream> {
    // The browser's voice processing is meant for calls: echo cancellation,
    // noise suppression and automatic gain all distort a sustained note.
    const audio: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name !== 'OverconstrainedError' && name !== 'TypeError') throw error;
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }

  private async connect(audio: AudioContext, stream: MediaStream): Promise<void> {
    const source = audio.createMediaStreamSource(stream);
    const highPass = audio.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = this.highPassHz;
    highPass.Q.value = Math.SQRT1_2;
    // Nodes are only processed while they lead to the destination, so the
    // capture node is connected to it through a muted gain.
    const mute = audio.createGain();
    mute.gain.value = 0;

    let tap: AudioNode;
    try {
      tap = await this.createWorkletTap(audio);
      this.capture = 'worklet';
    } catch {
      tap = this.createAnalyserTap(audio);
      this.capture = 'analyser';
    }

    source.connect(highPass);
    highPass.connect(tap);
    tap.connect(mute);
    mute.connect(audio.destination);
    this.highPass = highPass;
    this.nodes = [source, highPass, tap, mute];
  }

  private async createWorkletTap(audio: AudioContext): Promise<AudioNode> {
    if (!audio.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      throw new Error('AudioWorklet is not supported');
    }
    this.workletModule ??= audio.audioWorklet.addModule(processorUrl);
    try {
      await this.workletModule;
    } catch (error) {
      this.workletModule = null;
      throw error;
    }
    const node = new AudioWorkletNode(audio, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => this.deliver(event.data, false);
    return node;
  }

  private createAnalyserTap(audio: AudioContext): AudioNode {
    const analyser = audio.createAnalyser();
    analyser.fftSize = 32768;
    analyser.smoothingTimeConstant = 0;
    const buffer = new Float32Array(analyser.fftSize);
    this.pollTimer = setInterval(() => {
      if (audio.state !== 'running') return;
      analyser.getFloatTimeDomainData(buffer);
      this.deliver(buffer, true);
    }, POLL_INTERVAL_MS);
    return analyser;
  }

  private deliver(samples: Float32Array, replace: boolean): void {
    this.lastSamplesAt = performance.now();
    this.recoveryAttempts = 0;
    if (this.state === 'running') this.callbacks.onSamples(samples, replace);
  }

  private watch(audio: AudioContext, stream: MediaStream): void {
    const track = stream.getAudioTracks()[0];
    track?.addEventListener('ended', () => {
      if (this.stream !== stream) return;
      this.release();
      this.setState('interrupted');
    });

    if (!this.listeningToContext) {
      this.listeningToContext = true;
      audio.addEventListener('statechange', () => {
        if (this.state === 'running' && audio.state !== 'running') {
          this.setState('interrupted');
        } else if (this.state === 'interrupted' && audio.state === 'running' && this.stream) {
          this.lastSamplesAt = performance.now();
          this.setState('running');
        }
      });
    }

    this.watchdogTimer = setInterval(() => void this.checkHealth(), WATCHDOG_INTERVAL_MS);
  }

  /** Restarts capture when the page is visible but audio stopped arriving. */
  private async checkHealth(): Promise<void> {
    if (this.state !== 'running' || document.visibilityState !== 'visible') return;
    if (performance.now() - this.lastSamplesAt < STALL_MS) return;
    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      this.release();
      this.setState('interrupted');
      return;
    }
    this.recoveryAttempts++;
    const attempts = this.recoveryAttempts;
    try {
      await this.start();
    } catch {
      // start() already reported the idle state.
    }
    this.recoveryAttempts = attempts;
  }

  private release(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    if (this.watchdogTimer !== null) clearInterval(this.watchdogTimer);
    this.pollTimer = null;
    this.watchdogTimer = null;
    for (const node of this.nodes) {
      if (typeof AudioWorkletNode !== 'undefined' && node instanceof AudioWorkletNode) {
        node.port.onmessage = null;
      }
      node.disconnect();
    }
    this.nodes = [];
    this.highPass = null;
    this.capture = 'none';
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private setState(state: MicrophoneState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onStateChange(state);
  }
}
