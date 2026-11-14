import { PitchDetector } from './detector';
import { NoiseGate, rootMeanSquare } from './noise-gate';
import { PitchSmoother } from './smoother';

/** Detector readings less periodic than this are discarded. */
export const MIN_CLARITY = 0.8;
/** The input level is measured over this much of the most recent audio. */
const LEVEL_SECONDS = 0.05;
/** Longest gap between frames that still counts as continuous audio. */
const MAX_FRAME_GAP_SECONDS = 0.5;

export interface TrackerOptions {
  sampleRate: number;
  minFreq: number;
  maxFreq: number;
  /** How far above the ambient noise a note has to be, in dB. */
  gateDb: number;
}

export interface TrackerReading {
  /** Smoothed pitch in Hz, or null when no note is sounding. */
  frequency: number | null;
  /** What the detector found in this frame alone, before any filtering. */
  rawFrequency: number | null;
  /** Periodicity of this frame from 0 to 1; 0 when the gate is closed. */
  clarity: number;
  /** Input level (linear RMS, 1 = full scale). */
  rms: number;
  /** Estimated ambient noise level (linear RMS). */
  noiseFloor: number;
  gateOpen: boolean;
}

/**
 * The whole analysis chain for one frame of audio: noise gate, pitch
 * detection, confidence check and smoothing.
 */
export class PitchTracker {
  readonly detector: PitchDetector;
  readonly gate: NoiseGate;
  private readonly smoother = new PitchSmoother();
  private readonly levelSamples: number;
  private lastTimeMs: number | null = null;

  constructor(options: TrackerOptions) {
    this.detector = new PitchDetector(options);
    this.gate = new NoiseGate(options.gateDb);
    this.levelSamples = Math.round(LEVEL_SECONDS * options.sampleRate);
  }

  /** Number of samples each frame passed to `process` has to hold. */
  get windowSize(): number {
    return this.detector.windowSize;
  }

  /**
   * Analyses the most recent `windowSize` samples.
   *
   * @param timeMs Position of the end of the frame on the audio clock.
   */
  process(frame: Float32Array, timeMs: number): TrackerReading {
    const seconds =
      this.lastTimeMs === null
        ? 0
        : Math.min(MAX_FRAME_GAP_SECONDS, Math.max(0, (timeMs - this.lastTimeMs) / 1000));
    this.lastTimeMs = timeMs;

    const rms = rootMeanSquare(frame, this.levelSamples);
    const gateOpen = this.gate.update(rms);

    let rawFrequency: number | null = null;
    let clarity = 0;
    if (gateOpen) {
      const estimate = this.detector.detect(frame);
      if (estimate) {
        rawFrequency = estimate.frequency;
        clarity = estimate.clarity;
      }
    }
    const confident = rawFrequency !== null && clarity >= MIN_CLARITY;
    this.gate.learn(rms, confident, seconds);

    return {
      frequency: this.smoother.push(confident ? rawFrequency : null, timeMs),
      rawFrequency,
      clarity,
      rms,
      noiseFloor: this.gate.floor,
      gateOpen,
    };
  }

  /** Forgets the current note, keeping what was learned about the noise floor. */
  clearNote(): void {
    this.smoother.reset();
  }
}
