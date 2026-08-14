import { detectNavigationIntent } from "./intentMatcher";
import { moonshineService } from "./moonshineService";
import { whisperService } from "./whisperService";
import {
  summarizeCorpusResults,
  type CorpusBenchmarkModel,
  type CorpusBenchmarkObservation,
  type CorpusBenchmarkSummary,
} from "./corpusBenchmark";

export interface BenchmarkCorpusEntry {
  id: string;
  text: string;
  expectedPageId: string | null;
}

export interface CorpusModelEngine {
  id: CorpusBenchmarkModel;
  initialize(): Promise<void>;
  transcribe(
    entry: BenchmarkCorpusEntry,
    pcm: Float32Array,
  ): Promise<{ text: string; latencyMs: number }>;
  dispose(): Promise<void>;
}

export interface CorpusBenchmarkExport {
  generatedAt: string;
  corpus: BenchmarkCorpusEntry[];
  observations: CorpusBenchmarkObservation[];
  summaries: Record<CorpusBenchmarkModel, CorpusBenchmarkSummary>;
}

export interface CorpusBenchmarkProgress {
  model: CorpusBenchmarkModel;
  commandId: string | null;
  completed: number;
  total: number;
  message: string;
}

export async function runCorpusWithEngines({
  entries,
  engines,
  loadPcm,
  onProgress,
}: {
  entries: readonly BenchmarkCorpusEntry[];
  engines: readonly CorpusModelEngine[];
  loadPcm: (entry: BenchmarkCorpusEntry) => Promise<Float32Array>;
  onProgress?: (progress: CorpusBenchmarkProgress) => void;
}): Promise<CorpusBenchmarkExport> {
  const pcmById = new Map<string, Float32Array>();
  for (const entry of entries) pcmById.set(entry.id, await loadPcm(entry));

  const observations: CorpusBenchmarkObservation[] = [];
  const total = entries.length * engines.length;

  for (const engine of engines) {
    onProgress?.({
      model: engine.id,
      commandId: null,
      completed: observations.length,
      total,
      message: `Loading ${engine.id}`,
    });
    await engine.initialize();
    try {
      for (const entry of entries) {
        onProgress?.({
          model: engine.id,
          commandId: entry.id,
          completed: observations.length,
          total,
          message: `Running ${engine.id} / ${entry.id}`,
        });
        try {
          const result = await engine.transcribe(
            entry,
            new Float32Array(pcmById.get(entry.id) ?? []),
          );
          observations.push({
            commandId: entry.id,
            model: engine.id,
            expectedTranscript: entry.text,
            transcript: result.text.trim(),
            expectedPageId: entry.expectedPageId,
            detectedPageId: detectNavigationIntent(result.text).pageId,
            latencyMs: result.latencyMs,
            error: null,
          });
        } catch (error) {
          observations.push({
            commandId: entry.id,
            model: engine.id,
            expectedTranscript: entry.text,
            transcript: "",
            expectedPageId: entry.expectedPageId,
            detectedPageId: null,
            latencyMs: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      await engine.dispose();
    }
  }

  const summaries = Object.fromEntries(
    engines.map((engine) => [
      engine.id,
      summarizeCorpusResults(
        observations.filter((row) => row.model === engine.id),
      ),
    ]),
  ) as Record<CorpusBenchmarkModel, CorpusBenchmarkSummary>;

  return {
    generatedAt: new Date().toISOString(),
    corpus: [...entries],
    observations,
    summaries,
  };
}

export async function runBrowserCorpusBenchmark(
  onProgress?: (progress: CorpusBenchmarkProgress) => void,
): Promise<CorpusBenchmarkExport> {
  const entries = await fetchJson<BenchmarkCorpusEntry[]>(
    "/benchmark-audio/corpus.json",
  );
  return runCorpusWithEngines({
    entries,
    engines: createBrowserEngines(),
    loadPcm: async (entry) => {
      const response = await fetch(`/benchmark-audio/${entry.id}.wav`);
      if (!response.ok) throw new Error(`Unable to load ${entry.id}.wav`);
      return decodePcm16MonoWav(await response.arrayBuffer());
    },
    onProgress,
  });
}

export function decodePcm16MonoWav(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE file.");
  }

  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= view.byteLength) {
    const chunkId = ascii(view, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkData = offset + 8;
    if (chunkId === "fmt ") {
      format = {
        audioFormat: view.getUint16(chunkData, true),
        channels: view.getUint16(chunkData + 2, true),
        sampleRate: view.getUint32(chunkData + 4, true),
        bits: view.getUint16(chunkData + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = chunkData;
      dataLength = Math.min(chunkLength, view.byteLength - chunkData);
      break;
    }
    offset = chunkData + chunkLength + (chunkLength % 2);
  }

  if (
    !format ||
    format.audioFormat !== 1 ||
    format.channels !== 1 ||
    format.sampleRate !== 16_000 ||
    format.bits !== 16 ||
    dataOffset < 0
  ) {
    throw new Error("Expected mono PCM16 audio sampled at 16 kHz.");
  }

  const output = new Float32Array(Math.floor(dataLength / 2));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(dataOffset + index * 2, true) / 32768;
  }
  return output;
}

function createBrowserEngines(): CorpusModelEngine[] {
  return [
    createMoonshineEngine("small-streaming"),
    createMoonshineEngine("medium-streaming"),
    {
      id: "whisper-base-en-q5_1",
      initialize: () => whisperService.initialize(),
      transcribe: async (entry, pcm) => {
        const startedAt = performance.now();
        const result = await whisperService.transcribe(pcm, `corpus-${entry.id}`);
        return {
          text: result.text,
          latencyMs: performance.now() - startedAt,
        };
      },
      dispose: async () => whisperService.dispose(),
    },
  ];
}

function createMoonshineEngine(
  variant: "small-streaming" | "medium-streaming",
): CorpusModelEngine {
  return {
    id: variant,
    initialize: () => moonshineService.initialize(variant),
    transcribe: async (_entry, pcm) => {
      const withSilence = new Float32Array(pcm.length + 16_000 * 2);
      withSilence.set(pcm);
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const final = new Promise<{ text: string; latencyMs: number }>(
        (resolve, reject) => {
          let startedAt = 0;
          void moonshineService
            .beginStream(
              {
                onFinalTranscript: (result) =>
                  resolve({
                    text: result.text,
                    latencyMs: performance.now() - startedAt,
                  }),
                onError: reject,
              },
              variant,
            )
            .then(async (session) => {
              startedAt = performance.now();
              for (let offset = 0; offset < withSilence.length; offset += 1_600) {
                if (session.stopped) break;
                session.acceptAudio(withSilence.slice(offset, offset + 1_600));
                await sleep(100);
              }
              timeoutId = setTimeout(
                () => reject(new Error("Moonshine final transcript timed out.")),
                10_000,
              );
            })
            .catch(reject);
        },
      );

      try {
        return await final;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        await moonshineService.stopListening();
      }
    },
    dispose: () => moonshineService.dispose(),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json() as Promise<T>;
}

function ascii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index)),
  ).join("");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
