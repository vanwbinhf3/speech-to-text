import { describe, expect, it } from "vitest";
import {
  decodePcm16MonoWav,
  runCorpusWithEngines,
  type BenchmarkCorpusEntry,
  type CorpusModelEngine,
} from "./threeModelBenchmarkRunner";

describe("three-model corpus benchmark runner", () => {
  it("runs every corpus item and disposes each model before loading the next", async () => {
    const events: string[] = [];
    const entries: BenchmarkCorpusEntry[] = [
      { id: "one", text: "open tasks", expectedPageId: "tasks" },
      { id: "two", text: "what time is it", expectedPageId: null },
    ];
    const engines = [
      engine("small-streaming", events),
      engine("medium-streaming", events),
      engine("whisper-base-en-q5_1", events),
    ];

    const result = await runCorpusWithEngines({
      entries,
      engines,
      loadPcm: async (entry) =>
        entry.id === "one" ? new Float32Array([0.1]) : new Float32Array([0.2]),
    });

    expect(result.observations).toHaveLength(6);
    expect(events).toEqual([
      "small-streaming:init",
      "small-streaming:one:0.1",
      "small-streaming:two:0.2",
      "small-streaming:dispose",
      "medium-streaming:init",
      "medium-streaming:one:0.1",
      "medium-streaming:two:0.2",
      "medium-streaming:dispose",
      "whisper-base-en-q5_1:init",
      "whisper-base-en-q5_1:one:0.1",
      "whisper-base-en-q5_1:two:0.2",
      "whisper-base-en-q5_1:dispose",
    ]);
    expect(result.summaries["small-streaming"].intentAccuracy).toBe(1);
  });

  it("decodes a mono 16-bit 16 kHz WAV without changing samples", () => {
    const wav = createWav(new Int16Array([-32768, 0, 32767]));
    const pcm = decodePcm16MonoWav(wav);

    expect(Array.from(pcm)).toEqual([-1, 0, 32767 / 32768]);
  });
});

function engine(
  id: CorpusModelEngine["id"],
  events: string[],
): CorpusModelEngine {
  return {
    id,
    initialize: async () => {
      events.push(`${id}:init`);
    },
    transcribe: async (entry, pcm) => {
      events.push(`${id}:${entry.id}:${pcm[0].toFixed(1)}`);
      return { text: entry.text, latencyMs: 10 };
    },
    dispose: async () => {
      events.push(`${id}:dispose`);
    },
  };
}

function createWav(samples: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.byteLength);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) =>
    [...value].forEach((character, index) =>
      view.setUint8(offset + index, character.charCodeAt(0)),
    );
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.byteLength, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return buffer;
}
