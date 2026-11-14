/**
 * Sound of a plucked string, built from the physics of the instrument rather
 * than from recordings, so that it ships with the app and is exactly in tune
 * at any pitch and calibration.
 *
 * A plucked string vibrates at its fundamental and at (almost) whole
 * multiples of it, the partials. How strong each partial starts depends on
 * where the string is plucked and on how well the body of the instrument
 * gives out that frequency; how fast it dies away depends on its frequency,
 * the high ones going first, which is why a note starts bright and turns
 * mellow. The pluck also makes the body itself ring for a moment.
 */

/** Points of a response curve, lowest frequency first: [frequency in Hz, level in dB]. */
type Curve = ReadonlyArray<readonly [number, number]>;

export interface PluckVoice {
  /** Where the string is plucked, as a fraction of its length from the bridge. */
  pluckPosition: number;
  /** Where the pickup of an electric instrument sits, measured the same way. */
  pickupPosition?: number;
  /** Stiffness coefficient B of the string: partial k sits at k·f·sqrt(1 + B·k²). */
  inharmonicity: number;
  /** Decay rate in 1/s of a partial at f kHz: [a, b, c] for a + b·f + c·f². */
  decay: readonly [number, number, number];
  /** How loudly the body (or the pickup and amplifier) gives out each frequency. */
  response: Curve;
  /** Frequencies at which the body rings for a moment after the pluck, in Hz. */
  knock: readonly number[];
}

/**
 * How strongly a classical guitar radiates a partial of its strings, by
 * frequency. Estimated from recordings of the open strings of a nylon-string
 * guitar in an anechoic room (University of Iowa Musical Instrument Samples),
 * after taking out what the string alone explains: weak below the air
 * resonance of the body, strongest around the main resonance of the top,
 * falling off slowly above it.
 */
const GUITAR_BODY: Curve = [
  [70, -26],
  [100, -16],
  [140, -9],
  [200, -2],
  [250, 0],
  [330, -3],
  [450, -7],
  [600, -10],
  [800, -12],
  [1000, -13],
  [1500, -15],
  [2000, -16],
  [3000, -17],
  [4000, -22],
  [5000, -26],
  [7000, -34],
  [10000, -44],
];
/** Frequency of the strongest point of `GUITAR_BODY`, in Hz. */
const GUITAR_BODY_PEAK_HZ = 250;

/**
 * Body of another instrument, taken as a guitar body of a different size:
 * the resonances of a smaller box sit higher by the same factor.
 *
 * @param scale How much higher its resonances are than a guitar's.
 * @param tilt Brightness added above the main resonance, in dB per octave
 *             (steel strings and a pick put more into the high partials).
 */
function bodyLike(scale: number, tilt: number): Curve {
  return GUITAR_BODY.map(([hz, level]) => [
    hz * scale,
    level + tilt * Math.max(0, Math.log2(hz / GUITAR_BODY_PEAK_HZ)),
  ]);
}

/**
 * Classical guitar: nylon strings plucked with a fingertip over the sound
 * hole. The decay rates were measured on the same recordings as the body.
 */
const GUITAR: PluckVoice = {
  pluckPosition: 0.22,
  inharmonicity: 4e-5,
  decay: [0.5, 1.4, 0.35],
  response: GUITAR_BODY,
  knock: [105, 240],
};

/** Electric bass, plucked with the fingers, through a small amplifier. */
const BASS: PluckVoice = {
  pluckPosition: 0.19,
  pickupPosition: 0.16,
  inharmonicity: 6e-5,
  decay: [0.45, 1, 0.3],
  response: [
    [30, -14],
    [45, -7],
    [70, -2],
    [100, 0],
    [1500, 0],
    [2500, -3],
    [4000, -10],
    [6000, -20],
    [10000, -36],
  ],
  knock: [],
};

/** Ukulele: nylon strings, a small body and a short sustain. */
const UKULELE: PluckVoice = {
  pluckPosition: 0.28,
  inharmonicity: 2e-5,
  decay: [1.6, 1.6, 0.5],
  response: bodyLike(2.4, 0),
  knock: [250, 560],
};

/** Cavaquinho: steel strings played with a pick close to the bridge. */
const CAVAQUINHO: PluckVoice = {
  pluckPosition: 0.14,
  inharmonicity: 5e-5,
  decay: [1.8, 0.8, 0.15],
  response: bodyLike(2.5, 2),
  knock: [260, 600],
};

/** Mandolin: steel strings and a pick; one string of the pair. */
const MANDOLIN: PluckVoice = {
  pluckPosition: 0.12,
  inharmonicity: 5e-5,
  decay: [1.8, 0.8, 0.15],
  response: bodyLike(2.7, 2),
  knock: [280, 640],
};

/** Viola caipira: steel strings on a body a little smaller than a guitar's. */
const VIOLA_CAIPIRA: PluckVoice = {
  pluckPosition: 0.16,
  inharmonicity: 5e-5,
  decay: [0.8, 0.8, 0.15],
  response: bodyLike(1.15, 3),
  knock: [120, 275],
};

/** Voice of every instrument that has strings, by instrument id. */
export const PLUCK_VOICES: Readonly<Record<string, PluckVoice>> = {
  guitar: GUITAR,
  'bass-4': BASS,
  'bass-5': BASS,
  ukulele: UKULELE,
  cavaquinho: CAVAQUINHO,
  mandolin: MANDOLIN,
  'viola-caipira': VIOLA_CAIPIRA,
};

export function pluckVoiceFor(instrumentId: string): PluckVoice {
  return PLUCK_VOICES[instrumentId] ?? GUITAR;
}

/** The note is cut when its fundamental has faded this much, in dB... */
const FADED_DB = 50;
/** ...but it lasts at least and at most this long, in seconds. */
const MIN_SECONDS = 1.5;
const MAX_SECONDS = 5;
const FADE_IN_SECONDS = 0.002;
const FADE_OUT_SECONDS = 0.3;

const MAX_PARTIAL_HZ = 10000;
/** A partial is dropped once it is this much weaker than the strongest one at the start. */
const SILENCE = 1e-4;
/**
 * A string swings both towards the soundboard and parallel to it. The first
 * motion drives the body hard, so it is loud and soon spent; the second
 * lingers. This share of every partial therefore fades faster than the rest,
 * by this factor, which gives the note its punch at the start and its long
 * tail.
 */
const QUICK_SHARE = 0.25;
const QUICK_DECAY = 3;
/** Level of the knock of the body relative to the string, and its decay rate in 1/s. */
const KNOCK_LEVEL = 0.12;
const KNOCK_DECAY = 12;

/** Every note is brought to this loudness, unless that would take it past the peak. */
const LOUDNESS = 0.3;
const PEAK = 0.85;

/**
 * Samples (from -1 to 1) of a string tuned to `frequency` being plucked and
 * left to ring, starting at the pluck.
 */
export function synthesizePluck(
  frequency: number,
  sampleRate: number,
  voice: PluckVoice,
): Float32Array {
  const seconds = Math.min(
    MAX_SECONDS,
    Math.max(MIN_SECONDS, (FADED_DB * Math.LN10) / 20 / decayRate(frequency, voice)),
  );
  const mix = new Float64Array(Math.round(seconds * sampleRate));

  const stiffness = voice.inharmonicity;
  const limit = Math.min(MAX_PARTIAL_HZ, 0.45 * sampleRate);
  const partials: Array<{ hz: number; amplitude: number }> = [];
  let strongest = 0;
  let power = 0;
  let loudness = 0;
  for (let k = 1; ; k++) {
    // Stiffness stretches the partials; the first one stays on the note.
    const hz = k * frequency * Math.sqrt((1 + stiffness * k * k) / (1 + stiffness));
    if (hz > limit) break;
    const amplitude = stringPartial(k, voice) * 10 ** (levelAt(voice.response, hz) / 20);
    partials.push({ hz, amplitude });
    strongest = Math.max(strongest, Math.abs(amplitude));
    power += amplitude * amplitude;
    loudness += (amplitude * loudnessWeight(hz)) ** 2;
  }

  const floor = SILENCE * strongest;
  for (const { hz, amplitude } of partials) {
    const decay = decayRate(hz, voice);
    addDecayingSine(mix, sampleRate, hz, (1 - QUICK_SHARE) * amplitude, decay, 0, floor);
    addDecayingSine(mix, sampleRate, hz, QUICK_SHARE * amplitude, QUICK_DECAY * decay, 0, floor);
  }
  // The pluck also sets the body ringing at its own frequencies for a moment.
  const knock = KNOCK_LEVEL * Math.sqrt(power);
  for (const hz of voice.knock) {
    addDecayingSine(mix, sampleRate, hz, knock, KNOCK_DECAY, -Math.PI / 2, floor);
  }

  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]!));
  const gain = peak > 0 ? Math.min(LOUDNESS / Math.sqrt(loudness), PEAK / peak) : 0;

  const samples = new Float32Array(mix.length);
  const fadeIn = Math.max(1, Math.round(FADE_IN_SECONDS * sampleRate));
  const fadeOut = Math.round(FADE_OUT_SECONDS * sampleRate);
  for (let i = 0; i < mix.length; i++) {
    const fromEnd = mix.length - 1 - i;
    let envelope = gain;
    if (i < fadeIn) envelope *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
    if (fromEnd < fadeOut) envelope *= 0.5 - 0.5 * Math.cos((Math.PI * fromEnd) / fadeOut);
    samples[i] = mix[i]! * envelope;
  }
  return samples;
}

/**
 * Strength of partial `k` right after the pluck, with its sign. A string
 * pulled aside at one point and let go pushes on the bridge with partials
 * that fall as 1/k and vanish where the plucking point is a node; a pickup
 * hears each partial according to how much the string moves above it.
 */
function stringPartial(k: number, voice: PluckVoice): number {
  const amplitude = Math.sin(k * Math.PI * voice.pluckPosition) / k;
  return voice.pickupPosition === undefined
    ? amplitude
    : amplitude * Math.sin(k * Math.PI * voice.pickupPosition);
}

/** Level of a response curve at `hz` in dB, read between its points on a logarithmic scale. */
function levelAt(curve: Curve, hz: number): number {
  let [lowHz, lowLevel] = curve[0]!;
  if (hz <= lowHz) return lowLevel;
  for (let i = 1; i < curve.length; i++) {
    const [highHz, highLevel] = curve[i]!;
    if (hz <= highHz) {
      return lowLevel + ((highLevel - lowLevel) * Math.log(hz / lowHz)) / Math.log(highHz / lowHz);
    }
    lowHz = highHz;
    lowLevel = highLevel;
  }
  return lowLevel;
}

function decayRate(hz: number, voice: PluckVoice): number {
  const kHz = hz / 1000;
  const [base, linear, quadratic] = voice.decay;
  return base + linear * kHz + quadratic * kHz * kHz;
}

/**
 * A-weighting: how loud a tone at `hz` sounds next to one of the same level
 * at 1 kHz. It is also a fair picture of what a phone speaker does to low
 * notes.
 */
function loudnessWeight(hz: number): number {
  const f2 = hz * hz;
  return (
    (1.2589 * 12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
  );
}

/**
 * Adds amplitude·e^(-decay·t)·cos(2π·hz·t + phase) to `mix`, up to the moment
 * it fades below `floor`. A two-pole resonator produces it with two
 * multiplications per sample instead of a cosine and an exponential.
 */
function addDecayingSine(
  mix: Float64Array,
  sampleRate: number,
  hz: number,
  amplitude: number,
  decay: number,
  phase: number,
  floor: number,
): void {
  const size = Math.abs(amplitude);
  if (size <= floor) return;
  const count = Math.min(mix.length, Math.ceil((Math.log(size / floor) / decay) * sampleRate));
  const omega = (2 * Math.PI * hz) / sampleRate;
  const radius = Math.exp(-decay / sampleRate);
  const feedback = 2 * radius * Math.cos(omega);
  const damping = radius * radius;
  let previous = (amplitude * Math.cos(phase - omega)) / radius;
  let current = amplitude * Math.cos(phase);
  for (let i = 0; i < count; i++) {
    mix[i] = mix[i]! + current;
    const next = feedback * current - damping * previous;
    previous = current;
    current = next;
  }
}
