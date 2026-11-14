import { describe, expect, it } from 'vitest';
import { midiToFrequency, parseNote } from '../../src/music/notes';
import { chooseString, nearestStringIndex } from '../../src/music/string-match';
import { findInstrument, findTuning } from '../../src/music/tunings';

const strings = (instrument: string, tuning: string) =>
  findTuning(findInstrument(instrument), tuning)!.strings;
const hz = (note: string, a4 = 440) => midiToFrequency(parseNote(note), a4);
const detune = (frequency: number, cents: number) => frequency * 2 ** (cents / 1200);

describe('nearestStringIndex', () => {
  it('picks the closest string of a guitar in standard tuning', () => {
    const guitar = strings('guitar', 'standard');
    expect(nearestStringIndex(hz('E2'), guitar, 440)).toBe(0);
    expect(nearestStringIndex(hz('A2'), guitar, 440)).toBe(1);
    expect(nearestStringIndex(hz('D3'), guitar, 440)).toBe(2);
    expect(nearestStringIndex(hz('G3'), guitar, 440)).toBe(3);
    expect(nearestStringIndex(hz('B3'), guitar, 440)).toBe(4);
    expect(nearestStringIndex(hz('E4'), guitar, 440)).toBe(5);
  });

  it('still picks the right string when it is out of tune', () => {
    const guitar = strings('guitar', 'standard');
    expect(nearestStringIndex(detune(hz('A2'), -180), guitar, 440)).toBe(1);
    expect(nearestStringIndex(detune(hz('A2'), 220), guitar, 440)).toBe(1);
    expect(nearestStringIndex(detune(hz('G3'), 150), guitar, 440)).toBe(3);
  });

  it('uses the distance in cents, not the note name', () => {
    // Open G has three D strings and two G strings in different octaves.
    const openG = strings('guitar', 'open-g'); // D2 G2 D3 G3 B3 D4
    expect(nearestStringIndex(hz('D2'), openG, 440)).toBe(0);
    expect(nearestStringIndex(hz('D3'), openG, 440)).toBe(2);
    expect(nearestStringIndex(hz('D4'), openG, 440)).toBe(5);
    expect(nearestStringIndex(hz('G2'), openG, 440)).toBe(1);
    expect(nearestStringIndex(hz('G3'), openG, 440)).toBe(3);
    // A flat D3 is still the D3 string, not D2.
    expect(nearestStringIndex(detune(hz('D3'), -90), openG, 440)).toBe(2);

    // E2 and E4 share a name; an E3 in between is closer to D3 than to either.
    const guitar = strings('guitar', 'standard');
    expect(nearestStringIndex(hz('E3'), guitar, 440)).toBe(2);
  });

  it('separates the octave strings of a viola caipira pair', () => {
    const cebolao = strings('viola-caipira', 'cebolao-d'); // A2 A3 D3 D4 F#3 F#4 A3 A3 D4 D4
    expect(nearestStringIndex(hz('A2'), cebolao, 440)).toBe(0);
    expect(nearestStringIndex(hz('A3'), cebolao, 440)).toBe(1);
    expect(nearestStringIndex(hz('D3'), cebolao, 440)).toBe(2);
    expect(nearestStringIndex(hz('D4'), cebolao, 440)).toBe(3);
    expect(nearestStringIndex(hz('F#3'), cebolao, 440)).toBe(4);
    expect(nearestStringIndex(hz('F#4'), cebolao, 440)).toBe(5);
    expect(nearestStringIndex(detune(hz('A2'), 35), cebolao, 440)).toBe(0);
    expect(nearestStringIndex(detune(hz('F#4'), -35), cebolao, 440)).toBe(5);

    const rioAbaixo = strings('viola-caipira', 'rio-abaixo'); // G2 G3 D3 D4 G3 G4 B3 B3 D4 D4
    expect(nearestStringIndex(hz('G2'), rioAbaixo, 440)).toBe(0);
    expect(nearestStringIndex(hz('G3'), rioAbaixo, 440)).toBe(1);
    expect(nearestStringIndex(hz('G4'), rioAbaixo, 440)).toBe(5);
  });

  it('handles re-entrant tunings where the strings are not sorted by pitch', () => {
    const ukulele = strings('ukulele', 'standard'); // G4 C4 E4 A4
    expect(nearestStringIndex(hz('G4'), ukulele, 440)).toBe(0);
    expect(nearestStringIndex(hz('C4'), ukulele, 440)).toBe(1);
    expect(nearestStringIndex(hz('E4'), ukulele, 440)).toBe(2);
    expect(nearestStringIndex(hz('A4'), ukulele, 440)).toBe(3);
    expect(nearestStringIndex(hz('G3'), strings('ukulele', 'low-g'), 440)).toBe(0);
    // With a high G there is no G3 string: the closest one is C4.
    expect(nearestStringIndex(hz('G3'), ukulele, 440)).toBe(1);
  });

  it('respects the A4 calibration', () => {
    const guitar = strings('guitar', 'standard');
    expect(nearestStringIndex(hz('A2', 432), guitar, 432)).toBe(1);
    // 95.5 Hz is closer to A2 at 432 Hz and closer to E2 at 450 Hz.
    expect(nearestStringIndex(95.5, guitar, 432)).toBe(1);
    expect(nearestStringIndex(95.5, guitar, 450)).toBe(0);
  });

  it('clamps to the outer strings and handles an empty list', () => {
    const guitar = strings('guitar', 'standard');
    expect(nearestStringIndex(30, guitar, 440)).toBe(0);
    expect(nearestStringIndex(1500, guitar, 440)).toBe(5);
    expect(nearestStringIndex(440, [], 440)).toBe(-1);
  });
});

describe('chooseString', () => {
  const guitar = strings('guitar', 'standard');
  const midpoint = Math.sqrt(hz('E2') * hz('A2'));

  it('matches nearestStringIndex when there is no previous choice', () => {
    for (const note of ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']) {
      expect(chooseString(hz(note), guitar, 440)).toBe(nearestStringIndex(hz(note), guitar, 440));
    }
    expect(chooseString(440, [], 440)).toBe(-1);
  });

  it('keeps the current string near the midpoint between two strings', () => {
    expect(chooseString(detune(midpoint, 5), guitar, 440)).toBe(1);
    expect(chooseString(detune(midpoint, 5), guitar, 440, { current: 0 })).toBe(0);
    expect(chooseString(detune(midpoint, -5), guitar, 440, { current: 1 })).toBe(1);
  });

  it('switches once another string is clearly closer', () => {
    expect(chooseString(detune(midpoint, 40), guitar, 440, { current: 0 })).toBe(1);
    expect(chooseString(hz('A2'), guitar, 440, { current: 0 })).toBe(1);
    expect(chooseString(hz('E4'), guitar, 440, { current: 0 })).toBe(5);
  });

  it('never keeps a current string that is an octave away', () => {
    const cebolao = strings('viola-caipira', 'cebolao-d');
    expect(chooseString(hz('A3'), cebolao, 440, { current: 0 })).toBe(1);
    expect(chooseString(hz('A2'), cebolao, 440, { current: 1 })).toBe(0);
  });

  it('prefers the first string that is not tuned yet among equal pitches', () => {
    const cebolao = strings('viola-caipira', 'cebolao-d'); // A3 at 1, 6 and 7
    const tuned = new Array<boolean>(cebolao.length).fill(false);
    expect(chooseString(hz('A3'), cebolao, 440, { tuned })).toBe(1);
    tuned[1] = true;
    expect(chooseString(hz('A3'), cebolao, 440, { tuned })).toBe(6);
    tuned[6] = true;
    expect(chooseString(hz('A3'), cebolao, 440, { tuned })).toBe(7);
    tuned[7] = true;
    expect(chooseString(hz('A3'), cebolao, 440, { tuned })).toBe(1);
  });

  it('keeps the current string of a unison pair while the pitch still matches', () => {
    const cebolao = strings('viola-caipira', 'cebolao-d');
    const tuned = new Array<boolean>(cebolao.length).fill(false);
    tuned[7] = true;
    expect(chooseString(detune(hz('A3'), 8), cebolao, 440, { current: 7, tuned })).toBe(7);
  });
});
