/**
 * AudioWorklet processor that runs on the audio rendering thread. It only
 * gathers the microphone signal into fixed-size blocks and hands them to the
 * main thread, where the pitch analysis happens: the rendering thread has to
 * return within a few milliseconds and must not do heavy work.
 */

// Minimal declarations for the AudioWorkletGlobalScope.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void;

const BLOCK_SIZE = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK_SIZE);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, BLOCK_SIZE - this.filled);
      this.block.set(channel.subarray(offset, offset + count), this.filled);
      this.filled += count;
      offset += count;
      if (this.filled === BLOCK_SIZE) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(BLOCK_SIZE);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
