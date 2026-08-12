export const TARGET_SAMPLE_RATE = 16_000;

export type AudioChunkConsumer = (chunk: Float32Array) => void;

export function resampleLinear(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate = TARGET_SAMPLE_RATE,
): Float32Array {
  if (inputSampleRate === outputSampleRate) return new Float32Array(input);
  if (input.length === 0) return new Float32Array();

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.ceil(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const weight = sourceIndex - leftIndex;
    output[index] = input[leftIndex] * (1 - weight) + input[rightIndex] * weight;
  }

  return output;
}

export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array();
  if (channels.length === 1) return new Float32Array(channels[0]);

  const length = Math.min(...channels.map((channel) => channel.length));
  const output = new Float32Array(length);

  for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[sampleIndex];
    output[sampleIndex] = sum / channels.length;
  }

  return output;
}

export function concatFloat32Arrays(
  chunks: readonly Float32Array[],
): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

export class AudioChunkFanout {
  private readonly consumers = new Set<AudioChunkConsumer>();

  addConsumer(consumer: AudioChunkConsumer): () => void {
    this.consumers.add(consumer);
    return () => this.consumers.delete(consumer);
  }

  push(chunk: Float32Array): void {
    for (const consumer of this.consumers) {
      consumer(new Float32Array(chunk));
    }
  }
}
