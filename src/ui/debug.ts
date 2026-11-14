import type { MicrophoneInfo } from '../audio/microphone';
import type { TrackerReading } from '../pitch/tracker';

export interface DebugSnapshot {
  reading: TrackerReading | null;
  microphone: MicrophoneInfo;
  microphoneState: string;
  gateThreshold: number | null;
  windowSize: number | null;
  minFreq: number | null;
  maxFreq: number | null;
  /** Analyses per second. */
  frameRate: number;
  /** Average time spent on one analysis, in milliseconds. */
  analysisMs: number;
  wakeLock: string;
  detectionPaused: boolean;
}

/** Whether the page was opened with ?debug=1. */
export function isDebugEnabled(): boolean {
  const value = new URLSearchParams(window.location.search).get('debug');
  return value !== null && value !== '0' && value !== 'false';
}

function decibels(level: number): string {
  return level > 0 ? `${(20 * Math.log10(level)).toFixed(1)} dBFS` : '-inf dBFS';
}

function hertz(value: number | null | undefined): string {
  return value == null ? '-' : `${value.toFixed(2)} Hz`;
}

function yesNo(value: unknown): string {
  return value === undefined ? '?' : value ? 'on' : 'off';
}

/** Formats the diagnostics as plain text, so it can be copied into a bug report. */
export function formatDebug(snapshot: DebugSnapshot): string {
  const { reading, microphone } = snapshot;
  const settings = microphone.settings;
  const rate = microphone.sampleRate;
  const windowMs =
    rate && snapshot.windowSize ? `${((1000 * snapshot.windowSize) / rate).toFixed(0)} ms` : '-';
  return [
    `raw frequency : ${hertz(reading?.rawFrequency)}`,
    `smoothed      : ${hertz(reading?.frequency)}`,
    `confidence    : ${reading ? reading.clarity.toFixed(3) : '-'}`,
    `rms           : ${reading ? `${decibels(reading.rms)} (${reading.rms.toFixed(5)})` : '-'}`,
    `noise floor   : ${reading ? decibels(reading.noiseFloor) : '-'}`,
    `gate          : ${reading ? (reading.gateOpen ? 'open' : 'closed') : '-'}` +
      ` (opens at ${snapshot.gateThreshold === null ? '-' : decibels(snapshot.gateThreshold)})`,
    `sample rate   : ${rate ? `${rate} Hz` : '-'}`,
    `window        : ${snapshot.windowSize ?? '-'} samples (${windowMs})`,
    `range         : ${hertz(snapshot.minFreq)} to ${hertz(snapshot.maxFreq)}`,
    `analysis      : ${snapshot.frameRate.toFixed(1)}/s, ${snapshot.analysisMs.toFixed(2)} ms each` +
      (snapshot.detectionPaused ? ' (paused: reference tone)' : ''),
    `microphone    : ${snapshot.microphoneState}, capture=${microphone.capture}, context=${microphone.contextState}`,
    `track         : ${microphone.trackState}${microphone.trackLabel ? ` "${microphone.trackLabel}"` : ''}`,
    `processing    : echoCancellation=${yesNo(settings?.echoCancellation)}` +
      ` noiseSuppression=${yesNo(settings?.noiseSuppression)}` +
      ` autoGainControl=${yesNo(settings?.autoGainControl)}` +
      ` channels=${settings?.channelCount ?? '?'}`,
    `wake lock     : ${snapshot.wakeLock}`,
    `user agent    : ${navigator.userAgent}`,
  ].join('\n');
}
