import { getAudioContext } from '../audio/context';
import { FrameBuffer } from '../audio/frame-buffer';
import {
  Microphone,
  MicrophoneError,
  type MicrophoneErrorKind,
  type MicrophoneState,
} from '../audio/microphone';
import { ReferenceTone } from '../audio/reference-tone';
import { ScreenWakeLock } from '../audio/wake-lock';
import { midiToFrequency, noteLabel } from '../music/notes';
import {
  type FrequencyRange,
  INSTRUMENTS,
  type Instrument,
  type Tuning,
  detectionRange,
  findInstrument,
  findTuning,
} from '../music/tunings';
import { PitchTracker, type TrackerReading } from '../pitch/tracker';
import { formatDebug, isDebugEnabled } from './debug';
import { byId, segmented, showToast } from './dom';
import { Gauge } from './gauge';
import { TunerSession, type TunerView } from './session';
import {
  type Settings,
  type TunerMode,
  gateDbForSensitivity,
  loadSettings,
  saveSettings,
} from './settings';
import { setupSettingsDialog } from './settings-dialog';
import { StringList } from './strings';

/** Time between analyses, in seconds, for short and for long windows. */
const FAST_INTERVAL_SECONDS = 0.02;
const SLOW_INTERVAL_SECONDS = 0.04;
const LONG_WINDOW_SECONDS = 0.08;
/** Detection stays paused this long after the reference tone ends, in ms. */
const TONE_TAIL_MS = 300;
/** The "resume" prompt is delayed so it does not flash during automatic recovery. */
const INTERRUPTED_PROMPT_DELAY_MS = 500;
const DEBUG_REFRESH_MS = 250;
const NO_BREAK_SPACE = ' ';

const MICROPHONE_MESSAGES: Record<MicrophoneErrorKind, string> = {
  denied:
    'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.',
  'not-found': 'No microphone was found. Connect one and try again.',
  'in-use': 'The microphone is being used by another app. Close it and try again.',
  insecure: 'The microphone only works over a secure (HTTPS) connection.',
  unsupported: 'This browser does not support microphone access.',
  unknown: 'The microphone could not be started. Please try again.',
};

const MODE_HELP: Record<TunerMode, string> = {
  auto: 'Finds the string you play.',
  manual: 'Tap a string to tune against it.',
};

function formatCents(cents: number): string {
  const digits = Math.abs(cents) >= 100 ? 0 : 1;
  const magnitude = Math.abs(cents).toFixed(digits);
  const sign = Number(magnitude) === 0 ? '' : cents < 0 ? '−' : '+';
  return `${sign}${magnitude} cents`;
}

function formatHertz(frequency: number): string {
  return `${frequency.toFixed(frequency < 100 ? 2 : 1)} Hz`;
}

/** Connects the microphone, the pitch tracker and the screen. */
export class TunerApp {
  private settings: Settings = loadSettings();
  private instrument: Instrument;
  private tuning: Tuning | null;
  private range: FrequencyRange;

  private readonly session: TunerSession;
  private readonly microphone: Microphone;
  private readonly tone = new ReferenceTone();
  private readonly wakeLock = new ScreenWakeLock();
  private readonly gauge = new Gauge(byId<SVGSVGElement>('dial'));
  private readonly stringList: StringList;
  private readonly pressMode: (mode: TunerMode) => void;

  private tracker: PitchTracker | null = null;
  private buffer: FrameBuffer | null = null;
  private frame = new Float32Array(0);
  private hopSamples = 0;
  private samplesSinceAnalysis = 0;
  private reading: TrackerReading | null = null;

  private playingIndex: number | null = null;
  private pausedUntil = 0;
  private detectionPaused = false;
  private dirty = true;
  private promptTimer: ReturnType<typeof setTimeout> | undefined;

  private analysisCount = 0;
  private analysisRate = 0;
  private analysisMs = 0;

  constructor() {
    this.instrument = findInstrument(this.settings.instrumentId);
    this.tuning = this.rememberedTuning();
    this.range = detectionRange(this.strings, this.settings.a4);

    this.session = new TunerSession({
      strings: this.strings,
      mode: this.settings.mode,
      a4: this.settings.a4,
      toleranceCents: this.settings.toleranceCents,
    });
    this.session.onTuned = () => this.handleTuned();

    this.microphone = new Microphone({
      onSamples: (samples, replace) => this.handleSamples(samples, replace),
      onStateChange: (state) => this.handleMicrophoneState(state),
    });
    this.tone.onChange = (playing) => this.handleToneChange(playing);
    this.stringList = new StringList(byId('strings'), {
      onSelect: (index) => this.selectString(index),
      onPlay: (index) => void this.toggleTone(index),
    });
    this.pressMode = segmented<TunerMode>(byId('mode-toggle'), 'mode', (mode) => this.setMode(mode));

    this.setupSelectors();
    this.setupMicrophoneButton();
    this.setupLifecycle();
    if (isDebugEnabled()) this.setupDebug();

    const settingsDialog = setupSettingsDialog(this.settings, (patch) => this.updateSettings(patch));
    byId('settings-button').addEventListener('click', () => settingsDialog.open());

    this.gauge.setTolerance(this.settings.toleranceCents);
    this.setMode(this.settings.mode);
    this.applyTuning();
    this.handleMicrophoneState(this.microphone.state);

    const loop = (): void => {
      if (this.dirty) {
        this.dirty = false;
        this.render();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private get strings(): readonly number[] {
    return this.tuning?.strings ?? [];
  }

  private rememberedTuning(): Tuning | null {
    return findTuning(this.instrument, this.settings.tuningIds[this.instrument.id] ?? '');
  }

  // --- Instrument, tuning and mode -------------------------------------

  private setupSelectors(): void {
    const instrumentSelect = byId<HTMLSelectElement>('instrument-select');
    for (const instrument of INSTRUMENTS) {
      instrumentSelect.add(new Option(instrument.name, instrument.id));
    }
    instrumentSelect.value = this.instrument.id;
    instrumentSelect.addEventListener('change', () => {
      this.instrument = findInstrument(instrumentSelect.value);
      this.tuning = this.rememberedTuning();
      this.persist({ instrumentId: this.instrument.id });
      this.fillTuningSelect();
      this.applyTuning();
    });

    const tuningSelect = byId<HTMLSelectElement>('tuning-select');
    tuningSelect.addEventListener('change', () => {
      this.tuning = findTuning(this.instrument, tuningSelect.value);
      if (this.tuning) {
        this.persist({
          tuningIds: { ...this.settings.tuningIds, [this.instrument.id]: this.tuning.id },
        });
      }
      this.applyTuning();
    });
    this.fillTuningSelect();
  }

  private fillTuningSelect(): void {
    const select = byId<HTMLSelectElement>('tuning-select');
    select.replaceChildren(
      ...this.instrument.tunings.map((tuning) => new Option(tuning.name, tuning.id)),
    );
    if (this.tuning) select.value = this.tuning.id;
    byId('tuning-field').hidden = this.instrument.tunings.length === 0;
  }

  /** Shows the current tuning and points the detector at its range. */
  private applyTuning(): void {
    this.tone.stop();
    this.session.setStrings(this.strings);
    this.relabelStrings();
    const chromatic = this.strings.length === 0;
    byId('strings-section').dataset.chromatic = String(chromatic);
    byId('strings-hint').textContent = chromatic
      ? 'Chromatic mode shows the nearest note for any pitch.'
      : (this.instrument.hint ?? '');
    this.configureDetection();
    this.dirty = true;
  }

  private relabelStrings(): void {
    this.stringList.setStrings(
      this.strings.map((midi) => noteLabel(midi, this.settings)),
      this.instrument.stringsPerCourse,
    );
  }

  private setMode(mode: TunerMode): void {
    this.persist({ mode });
    this.session.setMode(mode);
    this.pressMode(mode);
    byId('mode-help').textContent = MODE_HELP[mode];
    this.dirty = true;
  }

  private selectString(index: number): void {
    if (this.settings.mode !== 'manual') this.setMode('manual');
    this.session.selectString(index);
    this.dirty = true;
  }

  private updateSettings(patch: Partial<Settings>): void {
    const previous = this.settings;
    this.persist(patch);
    if (this.settings.a4 !== previous.a4) {
      this.tone.stop();
      this.session.setA4(this.settings.a4);
      this.configureDetection();
    }
    if (this.settings.toleranceCents !== previous.toleranceCents) {
      this.session.setTolerance(this.settings.toleranceCents);
      this.gauge.setTolerance(this.settings.toleranceCents);
    }
    if (this.tracker) this.tracker.gate.thresholdDb = gateDbForSensitivity(this.settings.sensitivity);
    if (
      this.settings.notation !== previous.notation ||
      this.settings.accidental !== previous.accidental
    ) {
      this.relabelStrings();
    }
    this.dirty = true;
  }

  private persist(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
  }

  // --- Microphone -------------------------------------------------------

  private setupMicrophoneButton(): void {
    byId('mic-button').addEventListener('click', async () => {
      this.setMicrophoneMessage('');
      if (this.microphone.state === 'interrupted' && (await this.microphone.resume())) return;
      try {
        await this.microphone.start();
      } catch (error) {
        const kind = error instanceof MicrophoneError ? error.kind : 'unknown';
        this.setMicrophoneMessage(MICROPHONE_MESSAGES[kind]);
      }
    });
  }

  private setMicrophoneMessage(message: string): void {
    byId('mic-message').textContent = message;
  }

  private handleMicrophoneState(state: MicrophoneState): void {
    clearTimeout(this.promptTimer);
    const button = byId<HTMLButtonElement>('mic-button');
    const label = byId('mic-button-label');
    const app = byId('app');

    if (state === 'interrupted') {
      // Usually the page is in the background and capture comes back by
      // itself; only ask for a tap if it does not.
      this.promptTimer = setTimeout(() => {
        if (this.microphone.state !== 'interrupted') return;
        if (document.visibilityState !== 'visible') return;
        app.dataset.mic = 'interrupted';
        label.textContent = 'Resume microphone';
        button.disabled = false;
        this.setMicrophoneMessage('The microphone was paused. Tap to resume.');
      }, INTERRUPTED_PROMPT_DELAY_MS);
    } else {
      app.dataset.mic = state;
      label.textContent = state === 'starting' ? 'Starting…' : 'Enable microphone';
      button.disabled = state === 'starting';
    }

    if (state === 'running') {
      this.setMicrophoneMessage('');
      // Whatever was captured before a pause is stale.
      this.buffer?.clear();
      this.tracker?.clearNote();
      void this.wakeLock.enable();
    } else {
      void this.wakeLock.disable();
      this.session.update(null, performance.now());
    }
    this.dirty = true;
  }

  private setupLifecycle(): void {
    const comeBack = async (): Promise<void> => {
      await this.microphone.resume();
      if (this.microphone.state === 'running') await this.wakeLock.reacquire();
      else this.handleMicrophoneState(this.microphone.state);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.tone.stop();
        this.microphone.suspend();
      } else {
        void comeBack();
      }
    });
    // Pages restored from the back/forward cache do not fire visibilitychange.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) void comeBack();
    });
  }

  // --- Analysis ----------------------------------------------------------

  private configureDetection(): void {
    this.range = detectionRange(this.strings, this.settings.a4);
    this.microphone.setHighPass(Math.min(120, Math.max(15, this.range.minFreq / 2)));
    if (this.tracker) {
      this.tracker.setRange(this.range.minFreq, this.range.maxFreq);
      this.sizeFrame(this.tracker);
    }
  }

  private sizeFrame(tracker: PitchTracker): void {
    const seconds = tracker.windowSize / tracker.sampleRate;
    const interval = seconds > LONG_WINDOW_SECONDS ? SLOW_INTERVAL_SECONDS : FAST_INTERVAL_SECONDS;
    this.frame = new Float32Array(tracker.windowSize);
    this.hopSamples = Math.round(interval * tracker.sampleRate);
    this.samplesSinceAnalysis = this.hopSamples;
  }

  private ensureTracker(): PitchTracker {
    if (!this.tracker) {
      // The real rate of the device: 48 kHz on most phones, not always 44.1 kHz.
      const sampleRate = getAudioContext().sampleRate;
      this.tracker = new PitchTracker({
        sampleRate,
        ...this.range,
        gateDb: gateDbForSensitivity(this.settings.sensitivity),
      });
      this.buffer = new FrameBuffer(Math.ceil(0.4 * sampleRate));
      this.sizeFrame(this.tracker);
    }
    return this.tracker;
  }

  private handleSamples(samples: Float32Array, replace: boolean): void {
    const tracker = this.ensureTracker();
    const buffer = this.buffer!;
    if (replace) buffer.replace(samples);
    else buffer.push(samples);

    this.samplesSinceAnalysis += replace ? this.hopSamples : samples.length;
    if (this.samplesSinceAnalysis < this.hopSamples) return;
    this.samplesSinceAnalysis = 0;

    const now = performance.now();
    if (this.tone.playing || now < this.pausedUntil) {
      // The microphone would only hear the reference tone itself.
      if (!this.detectionPaused) {
        this.detectionPaused = true;
        tracker.clearNote();
        this.showView(this.session.update(null, now));
      }
      return;
    }
    this.detectionPaused = false;
    if (!buffer.read(this.frame)) return;

    this.reading = tracker.process(this.frame, now);
    this.analysisCount++;
    this.analysisMs += 0.1 * (performance.now() - now - this.analysisMs);
    this.showView(this.session.update(this.reading.frequency, now));
  }

  private lastView: TunerView | null = null;

  private showView(view: TunerView): void {
    if (view !== this.lastView) {
      this.lastView = view;
      this.dirty = true;
    }
  }

  private handleTuned(): void {
    navigator.vibrate?.(40);
    const tuned = this.session.view.tuned;
    if (tuned.length > 0 && tuned.every(Boolean)) showToast('All strings are in tune');
  }

  // --- Reference tone ----------------------------------------------------

  private async toggleTone(index: number): Promise<void> {
    if (this.playingIndex === index && this.tone.playing) {
      this.tone.stop();
      return;
    }
    const midi = this.strings[index];
    if (midi === undefined) return;
    if (await this.tone.play(midiToFrequency(midi, this.settings.a4))) {
      this.playingIndex = index;
    } else {
      showToast('Could not start audio playback');
    }
    this.dirty = true;
  }

  private handleToneChange(playing: boolean): void {
    if (!playing) {
      this.playingIndex = null;
      this.pausedUntil = performance.now() + TONE_TAIL_MS;
    }
    this.dirty = true;
  }

  // --- Rendering ---------------------------------------------------------

  private render(): void {
    const view = this.session.view;
    const gauge = byId('gauge');
    gauge.dataset.state = view.active && view.direction ? view.direction : 'idle';
    this.gauge.setCents(view.active ? view.cents : null);

    byId('note').toggleAttribute('data-empty', view.targetMidi === null);
    if (view.targetMidi === null) {
      byId('note-name').textContent = '–';
      byId('note-accidental').textContent = '';
      byId('note-octave').textContent = '';
    } else {
      const label = noteLabel(view.targetMidi, this.settings);
      byId('note-name').textContent = label.base;
      byId('note-accidental').textContent = label.accidental;
      byId('note-octave').textContent = String(label.octave);
    }
    byId('hint').textContent = this.hintFor(view);
    byId('cents').textContent = view.cents === null ? NO_BREAK_SPACE : formatCents(view.cents);
    byId('hertz').textContent =
      view.frequency === null ? NO_BREAK_SPACE : formatHertz(view.frequency);

    const manual = this.settings.mode === 'manual' && this.strings.length > 0;
    this.stringList.render({
      activeIndex: view.active ? view.stringIndex : null,
      selectedIndex: manual ? this.session.selectedString : null,
      tuned: view.tuned,
      playingIndex: this.playingIndex,
      inTune: view.direction === 'in-tune',
    });
  }

  private hintFor(view: TunerView): string {
    if (view.active) {
      if (view.direction === 'flat') return 'Tighten';
      if (view.direction === 'sharp') return 'Loosen';
      return 'In tune';
    }
    if (this.tone.playing) return 'Playing reference tone';
    if (this.microphone.state !== 'running') return NO_BREAK_SPACE;
    if (this.strings.length === 0) return 'Play a note';
    if (view.targetMidi !== null) {
      return `Play the ${noteLabel(view.targetMidi, this.settings).text} string`;
    }
    return 'Play a string';
  }

  // --- Diagnostics (?debug=1) ----------------------------------------------

  private setupDebug(): void {
    const output = byId('debug-output');
    byId('debug-panel').hidden = false;
    document.body.dataset.debug = 'true';

    let lastCount = 0;
    let lastTime = performance.now();
    const snapshot = (): string =>
      formatDebug({
        reading: this.reading,
        microphone: this.microphone.info,
        microphoneState: this.microphone.state,
        gateThreshold: this.tracker?.gate.threshold ?? null,
        windowSize: this.tracker?.windowSize ?? null,
        minFreq: this.tracker?.detector.minFreq ?? this.range.minFreq,
        maxFreq: this.tracker?.detector.maxFreq ?? this.range.maxFreq,
        frameRate: this.analysisRate,
        analysisMs: this.analysisMs,
        wakeLock: !this.wakeLock.supported
          ? 'not supported'
          : this.wakeLock.active
            ? 'active'
            : 'inactive',
        detectionPaused: this.detectionPaused,
      });

    setInterval(() => {
      const now = performance.now();
      if (now - lastTime >= 1000) {
        this.analysisRate = ((this.analysisCount - lastCount) * 1000) / (now - lastTime);
        lastCount = this.analysisCount;
        lastTime = now;
      }
      output.textContent = snapshot();
    }, DEBUG_REFRESH_MS);

    byId('debug-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(snapshot());
        showToast('Diagnostics copied');
      } catch {
        showToast('Could not copy; select the text instead');
      }
    });
  }
}
