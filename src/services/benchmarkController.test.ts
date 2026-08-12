import { describe, expect, it, vi } from "vitest";

import { BenchmarkController } from "./benchmarkController";
import {
  calculateInputPeakVolume,
  calculateInputVolume,
  type AudioCaptureCallbacks,
  type AudioCaptureSession,
} from "./audioCaptureService";
import type { MoonshineStreamSession, SpeechRecognitionCallbacks } from "./moonshineService";
import type { WhisperTranscriptResult } from "./whisperService";

describe("BenchmarkController", () => {
  it("loads only Moonshine initially and defers Whisper until Moonshine final", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();

    expect(fakes.dependencies.moonshine.initialize).toHaveBeenCalledTimes(1);
    expect(fakes.dependencies.whisper.initialize).not.toHaveBeenCalled();
    expect(controller.getSnapshot().moonshineStatus).toBe("ready");
    expect(controller.getSnapshot().whisperStatus).toBe("idle");
  });

  it("auto-stops capture and starts Whisper after Moonshine final", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    fakes.emitMoonshineFinal("open dashboard");

    await vi.waitFor(() => expect(fakes.audioSession.stopCalls).toBe(1));
    await vi.waitFor(() => expect(fakes.dependencies.whisper.initialize).toHaveBeenCalledTimes(1));
    expect(fakes.whisperTranscribeCalls).toHaveLength(1);
    expect(controller.getSnapshot().currentRun?.moonshine?.intent.pageId).toBe("dashboard");
  });

  it("records per-model timers from audio input handoff to model result", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    fakes.emitAudioInput();
    fakes.emitMoonshineFinal("open dashboard");
    await vi.waitFor(() => expect(fakes.whisperTranscribeCalls).toHaveLength(1));
    fakes.resolveWhisper("open dashboard");

    await vi.waitFor(() => expect(controller.getSnapshot().history).toHaveLength(1));
    const run = controller.getSnapshot().history[0];

    expect(run.moonshine?.metrics.modelAudioReceivedAt).toBe(1_020);
    expect(run.moonshine?.metrics.modelResultReadyAt).toBe(1_030);
    expect(run.moonshine?.metrics.modelProcessingTimeMs).toBe(10);
    expect(run.whisper?.metrics.modelAudioReceivedAt).toBe(1_070);
    expect(run.whisper?.metrics.modelResultReadyAt).toBe(1_080);
    expect(run.whisper?.metrics.modelProcessingTimeMs).toBe(10);
  });

  it("updates input volume while recording and resets it after stop", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    fakes.emitAudioInput(Float32Array.from([0.5, -0.5]));

    expect(controller.getSnapshot().inputVolume).toBeCloseTo(0.5);
    expect(controller.getSnapshot().inputPeakVolume).toBeCloseTo(0.5);

    await controller.stop();

    expect(controller.getSnapshot().inputVolume).toBe(0);
    expect(controller.getSnapshot().inputPeakVolume).toBe(0);
  });

  it("passes the selected audio processing config into microphone capture", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    controller.updateAudioProcessingConfig({
      inputGain: 3,
      noiseGateEnabled: true,
      browserProcessingMode: "raw",
    });
    await controller.initializeModels();
    await controller.start();

    expect(fakes.audioSession.callbacks?.audioProcessingConfig).toMatchObject({
      inputGain: 3,
      noiseGateEnabled: true,
      noiseGateThreshold: 0.015,
      browserProcessingMode: "raw",
    });
  });

  it("ignores stale Whisper updates after reset", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    fakes.emitMoonshineFinal("open dashboard");
    await controller.reset();
    fakes.resolveWhisper("open settings");

    await Promise.resolve();

    expect(controller.getSnapshot().history).toHaveLength(0);
    expect(controller.getSnapshot().currentRun).toBeNull();
  });

  it("keeps the newest 20 completed runs", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    for (let index = 0; index < 22; index += 1) {
      await controller.start();
      fakes.emitMoonshineFinal("open dashboard");
      await vi.waitFor(() =>
        expect(fakes.whisperTranscribeCalls).toHaveLength(index + 1),
      );
      fakes.resolveWhisper("open dashboard");
      await vi.waitFor(() => expect(controller.getSnapshot().history[0]?.id).toBe(`run-${index + 1}`));
    }

    expect(controller.getSnapshot().history).toHaveLength(20);
    expect(controller.getSnapshot().history.at(-1)?.id).toBe("run-3");
  });

  it("does not run Whisper after manual stop without a Moonshine final", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    await controller.stop();

    expect(fakes.audioSession.stopCalls).toBe(1);
    expect(fakes.dependencies.whisper.initialize).not.toHaveBeenCalled();
    expect(fakes.whisperTranscribeCalls).toHaveLength(0);
    expect(controller.getSnapshot().history).toHaveLength(0);
    expect(controller.getSnapshot().currentRun?.error).toBe(
      "Stopped before Moonshine returned a final transcript.",
    );
  });

  it("keeps a Moonshine result when Whisper fails", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    fakes.emitMoonshineFinal("open dashboard");
    await vi.waitFor(() => expect(fakes.whisperTranscribeCalls).toHaveLength(1));
    fakes.rejectWhisper(new Error("worker crashed"));

    await vi.waitFor(() => expect(controller.getSnapshot().history).toHaveLength(1));
    expect(controller.getSnapshot().history[0].moonshine?.intent.pageId).toBe("dashboard");
    expect(controller.getSnapshot().history[0].whisper).toBeNull();
  });

  it("stops Moonshine and clears active run when microphone start fails", async () => {
    const fakes = createFakes();
    fakes.dependencies.audioCapture.start = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await expect(controller.start()).rejects.toThrow("permission denied");

    expect(fakes.latestMoonshineSession?.stopped).toBe(true);
    expect(controller.getSnapshot().status).toBe("error");
  });
});

function createFakes() {
  let moonshineCallbacks: SpeechRecognitionCallbacks | null = null;
  let whisperResolve:
    | ((result: WhisperTranscriptResult) => void)
    | null = null;
  let whisperReject: ((error: Error) => void) | null = null;
  let latestMoonshineSession: FakeMoonshineSession | null = null;
  let nowValue = 1_000;

  const audioSession = new FakeAudioSession();
  const whisperTranscribeCalls: Float32Array[] = [];
  const dependencies = {
    now: () => {
      nowValue += 10;
      return nowValue;
    },
    setTimeout: (callback: () => void) => {
      const id = globalThis.setTimeout(callback, 0);
      return id;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    audioCapture: {
      start: vi.fn(async (callbacks?: AudioCaptureCallbacks) => {
        audioSession.setCallbacks(callbacks);
        return audioSession;
      }),
    },
    moonshine: {
      initialize: vi.fn(async () => undefined),
      beginStream: vi.fn(async (callbacks: SpeechRecognitionCallbacks) => {
        moonshineCallbacks = callbacks;
        latestMoonshineSession = new FakeMoonshineSession();
        return latestMoonshineSession;
      }),
      stopListening: vi.fn(async () => undefined),
      onModelProgress: vi.fn(),
    },
    whisper: {
      initialize: vi.fn(async () => undefined),
      transcribe: vi.fn((pcm: Float32Array, requestId: string) => {
        whisperTranscribeCalls.push(pcm);
        return new Promise<WhisperTranscriptResult>((resolve, reject) => {
          whisperResolve = (result) => resolve({ ...result, requestId });
          whisperReject = reject;
        });
      }),
    },
  };

  return {
    dependencies,
    get latestMoonshineSession() {
      return latestMoonshineSession;
    },
    audioSession,
    whisperTranscribeCalls,
    emitMoonshineFinal(transcript: string) {
      moonshineCallbacks?.onFinalTranscript?.({
        text: transcript,
        sttCompletionTimeMs: 30,
        lineId: `moonshine-${transcript}`,
      });
    },
    emitAudioInput(chunk = Float32Array.from([0.1, 0.2])) {
      audioSession.emitInput(chunk);
    },
    resolveWhisper(transcript: string) {
      whisperResolve?.({
        requestId: "latest",
        text: transcript,
        inferenceStartedAt: nowValue + 10,
        transcriptReadyAt: nowValue + 30,
        inferenceTimeMs: 20,
      });
      whisperResolve = null;
    },
    rejectWhisper(error: Error) {
      whisperReject?.(error);
      whisperReject = null;
    },
  };
}

class FakeAudioSession implements AudioCaptureSession {
  stopped = false;
  stopCalls = 0;
  private consumer: ((chunk: Float32Array) => void) | null = null;
  callbacks?: AudioCaptureCallbacks;

  setCallbacks(callbacks?: AudioCaptureCallbacks): void {
    this.callbacks = callbacks;
  }

  emitInput(chunk: Float32Array): void {
    this.callbacks?.onInputLevel?.({
      rms: calculateInputVolume(chunk),
      peak: calculateInputPeakVolume(chunk),
    });
    this.callbacks?.onVolume?.(calculateInputVolume(chunk));
    this.callbacks?.onChunk?.(chunk);
    this.consumer?.(chunk);
  }

  addConsumer(consumer: (chunk: Float32Array) => void): () => void {
    this.consumer = consumer;
    return () => {
      this.consumer = null;
    };
  }

  async stop(): Promise<Float32Array> {
    this.stopCalls += 1;
    this.stopped = true;
    return Float32Array.from([0.1, 0.2]);
  }
}

class FakeMoonshineSession implements MoonshineStreamSession {
  stopped = false;

  acceptAudio(): void {}

  async stop(): Promise<void> {
    this.stopped = true;
  }
}
