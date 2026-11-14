# Pluck Tuner

A tuner for string instruments that runs entirely in the browser. It listens
through the microphone, shows the note inside a dial from -50 to +50 cents and
tells you whether to tighten or loosen the string. It installs as an app (PWA),
works offline, and the audio never leaves your device.

**Live app:** <https://rodrigolmr.github.io/tuner/>

- Guitar (7 tunings), 4- and 5-string bass, ukulele, cavaquinho, mandolin,
  viola caipira (Cebolão in D, Cebolão in E, Rio Abaixo) and a chromatic mode.
- Automatic mode (finds the string you play) and manual mode (tap a string).
- Reference note for every string, sounding like that string plucked on the
  instrument, A4 calibration from 430 to 450 Hz, letter or Do Re Mi note names,
  sharps or flats, adjustable tolerance and sensitivity.
- Once the microphone has been allowed, later visits start listening without a
  tap wherever the browser lets audio start by itself (an installed app, for
  example). The microphone is closed whenever the app is not on screen.

## Run it locally

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open <http://localhost:5173/tuner/>. Browsers only allow the microphone on
`localhost` or over HTTPS, so to try it on a phone use the published site.

## Tests

```sh
npm test            # unit tests (Vitest)
npm run test:e2e    # builds, then drives the production build in Chrome (Playwright)
```

The unit tests feed synthetic signals to the pitch detector at 44.1 and 48 kHz:
sine, sawtooth, missing fundamental, white noise at 20 dB SNR and a plucked
string, from A#0 to E5. The end-to-end tests open the built site in the
installed Google Chrome with a fake microphone that plays WAV files of known
frequency, and check the note and cents shown on screen. Set
`PW_CHANNEL=chromium` to use Playwright's own browser instead
(`npx playwright install chromium`).

## Publish

Every push to `main` runs `.github/workflows/deploy.yml`, which tests, builds
and deploys `dist/` to GitHub Pages. One-time setup for a new repository:

```sh
gh repo create tuner --public --source=. --push
gh api -X POST repos/{owner}/tuner/pages -f build_type=workflow
```

GitHub Pages serves the site from `/<repository>/`, which is the default Vite
base (`/tuner/`). To host it elsewhere, build with another base:

```sh
BASE_PATH=/ npm run build
```

## Install it as an app

- **Android (Chrome, Samsung Internet):** open the site, then menu → *Add to
  Home screen* / *Install app*.
- **iPhone and iPad (Safari):** Share button → *Add to Home Screen*.
- **Windows, macOS, Linux (Chrome, Edge):** click the install icon in the
  address bar.

When a new version is published, the app shows an *Update* button.

## Troubleshooting

Add `?debug=1` to the address to see a diagnostics panel with the raw
frequency, input level, confidence, sample rate and what the browser did with
the microphone. Its *Copy* button puts all of it on the clipboard for a bug
report.

## How it works

| Folder      | Contents                                                           |
| ----------- | ------------------------------------------------------------------ |
| `src/audio` | Microphone capture (AudioWorklet), reference notes, screen wake lock |
| `src/pitch` | Pitch detector, noise gate, smoothing                               |
| `src/music` | Notes, cents, instruments and tunings, string matching              |
| `src/ui`    | Screen, settings, sharing, diagnostics                              |

The detector is an implementation of the McLeod Pitch Method with no pitch
detection library. A first pass computes the normalized square difference
function on a decimated signal and picks the period, which also works when the
fundamental is weak or missing (as with a bass through a phone microphone). A
second pass keeps only the first few harmonics and locates the period with
parabolic interpolation, to well under one cent on a clean signal. The analysis
window is sized from the lowest note of the selected tuning, so high
instruments respond faster than a 5-string bass.

The reference notes are not recordings. Each one is computed when it is first
played, from a model of the plucked string: the partials that a pluck at a
given point excites, each fading at its own rate, coloured by the resonances of
the instrument's body. That keeps the app small and offline, and the note
exactly in tune for any tuning and calibration; the unit tests have the tuner
itself confirm every string within one cent.
