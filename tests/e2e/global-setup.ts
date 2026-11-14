import { writeToneFiles } from './tones';

/** Generates the audio files that Chrome feeds to the page as microphone input. */
export default function globalSetup(): void {
  writeToneFiles();
}
