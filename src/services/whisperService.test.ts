import { describe, expect, it, vi } from "vitest";

import { WhisperService, type WhisperWorkerMessage } from "./whisperService";

describe("WhisperService", () => {
  it("caches the worker init promise", async () => {
    const worker = new FakeWhisperWorker();
    const service = new WhisperService(() => worker);

    const first = service.initialize();
    const second = service.initialize();
    worker.emit({ type: "ready", loadTimeMs: 123, modelSizeBytes: 32_166_155 });

    await Promise.all([first, second]);

    expect(worker.postedMessages.filter((message) => message.type === "init"))
      .toHaveLength(1);
  });

  it("rejects a stale transcription when a newer request is active", async () => {
    const worker = new FakeWhisperWorker();
    const service = new WhisperService(() => worker);
    const initialization = service.initialize();
    worker.emit({ type: "ready", loadTimeMs: 123, modelSizeBytes: 32_166_155 });
    await initialization;

    const first = service.transcribe(Float32Array.from([0.1]), "first");
    const second = service.transcribe(Float32Array.from([0.2]), "second");
    const firstError = first.catch((error: Error) => error);

    await vi.waitFor(() =>
      expect(worker.postedMessages.filter((message) => message.type === "transcribe"))
        .toHaveLength(2),
    );

    worker.emit({
      type: "result",
      requestId: "first",
      text: "open dashboard",
      inferenceStartedAt: 10,
      transcriptReadyAt: 20,
    });
    worker.emit({
      type: "result",
      requestId: "second",
      text: "open settings",
      inferenceStartedAt: 30,
      transcriptReadyAt: 45,
    });

    expect(((await firstError) as Error).message).toMatch(/stale/i);
    await expect(second).resolves.toMatchObject({
      requestId: "second",
      text: "open settings",
      inferenceTimeMs: 15,
    });
  });

  it("forwards model load progress", async () => {
    const worker = new FakeWhisperWorker();
    const service = new WhisperService(() => worker);
    const onProgress = vi.fn();

    const initialization = service.initialize({ onProgress });
    worker.emit({
      type: "progress",
      fraction: 0.5,
      file: "ggml-tiny.en-q5_1.bin",
      loaded: 16,
      total: 32,
    });
    worker.emit({ type: "ready", loadTimeMs: 10, modelSizeBytes: 32 });
    await initialization;

    expect(onProgress).toHaveBeenCalledWith({
      fraction: 0.5,
      file: "ggml-tiny.en-q5_1.bin",
      loaded: 16,
      total: 32,
    });
  });
});

class FakeWhisperWorker {
  postedMessages: WhisperWorkerMessage[] = [];
  onmessage: ((event: MessageEvent<WhisperWorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: WhisperWorkerMessage): void {
    this.postedMessages.push(message);
  }

  terminate(): void {}

  emit(message: WhisperWorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WhisperWorkerMessage>);
  }
}
