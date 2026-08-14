import { describe, expect, it, vi } from "vitest";

import { BenchmarkController } from "./benchmarkController";
import {
  calculateInputPeakVolume,
  calculateInputVolume,
  type AudioCaptureCallbacks,
  type AudioCaptureSession,
} from "./audioCaptureService";
import type {
  FinalTranscriptResult,
  MoonshineModelVariant,
  SpeechRecognitionCallbacks,
} from "./moonshineService";
import { SpeechServiceError } from "./moonshineService";

describe("BenchmarkController", () => {
  it("loads Small Streaming by default and leaves Whisper unused", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();

    expect(fakes.dependencies.moonshine.initialize).toHaveBeenCalledWith(
      "small-streaming",
    );
    expect(controller.getSnapshot()).toMatchObject({
      selectedModel: "small-streaming",
      moonshineStatus: "ready",
      whisperStatus: "idle",
    });
    expect(fakes.dependencies.whisper.initialize).not.toHaveBeenCalled();
  });

  it("loads Medium after the selected model changes", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();

    await controller.selectModel("medium-streaming");

    expect(fakes.dependencies.moonshine.initialize).toHaveBeenLastCalledWith(
      "medium-streaming",
    );
    expect(controller.getSnapshot().selectedModel).toBe("medium-streaming");
  });

  it("loads Tiny after the selected model changes", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();

    await controller.selectModel("tiny-streaming");

    expect(fakes.dependencies.moonshine.initialize).toHaveBeenLastCalledWith(
      "tiny-streaming",
    );
    expect(controller.getSnapshot().selectedModel).toBe("tiny-streaming");
  });

  it("streams every captured PCM chunk only to the selected Moonshine model", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();
    await controller.selectModel("medium-streaming");

    await controller.start();
    const chunk = Float32Array.from([0.1, 0.2]);
    fakes.emitAudioInput(chunk);

    expect(fakes.dependencies.moonshine.beginStream).toHaveBeenCalledWith(
      expect.any(Object),
      "medium-streaming",
    );
    expect(fakes.moonshineSession.acceptedAudio).toEqual([chunk]);
  });

  it("records model timer from the first audio chunk to final transcript", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();
    await controller.start("dashboard");
    fakes.emitAudioInput();

    fakes.emitFinal("open dashboard", 81);

    await vi.waitFor(() => expect(controller.getSnapshot().history).toHaveLength(1));
    const result = controller.getSnapshot().history[0].moonshine;
    expect(result?.modelVariant).toBe("small-streaming");
    expect(result?.metrics.sttCompletionTimeMs).toBe(81);
    expect(result?.metrics.modelProcessingTimeMs).toBe(
      (result?.metrics.modelResultReadyAt ?? 0) -
        (result?.metrics.modelAudioReceivedAt ?? 0),
    );
    expect(controller.getSnapshot().history[0].whisper?.transcript).toBe(
      "open dashboard",
    );
    const whisper = controller.getSnapshot().history[0].whisper;
    expect(whisper?.metrics.modelAudioReceivedAt).toBeGreaterThanOrEqual(
      result?.metrics.modelResultReadyAt ?? 0,
    );
    expect(whisper?.metrics.modelProcessingTimeMs).toBe(
      (whisper?.metrics.modelResultReadyAt ?? 0) -
        (whisper?.metrics.modelAudioReceivedAt ?? 0),
    );
  });

  it("runs Whisper on the complete recording only after Moonshine final", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();
    await controller.start("tasks");
    fakes.emitAudioInput(Float32Array.from([0.25, -0.5]));

    expect(fakes.dependencies.whisper.initialize).not.toHaveBeenCalled();
    expect(fakes.dependencies.whisper.transcribe).not.toHaveBeenCalled();

    fakes.emitFinal("open tasks", 75);

    await vi.waitFor(() =>
      expect(fakes.dependencies.whisper.transcribe).toHaveBeenCalledTimes(1),
    );
    expect(fakes.dependencies.whisper.initialize).toHaveBeenCalledTimes(1);
    expect(fakes.dependencies.whisper.transcribe).toHaveBeenCalledWith(
      Float32Array.from([0.25, -0.5]),
      "run-1",
    );
    await vi.waitFor(() => expect(controller.getSnapshot().history).toHaveLength(1));
    expect(controller.getSnapshot().history[0].moonshine?.transcript).toBe(
      "open tasks",
    );
    expect(controller.getSnapshot().history[0].whisper?.transcript).toBe(
      "open tasks",
    );
  });

  it("keeps the Moonshine result when Whisper initialization fails", async () => {
    const fakes = createFakes();
    fakes.dependencies.whisper.initialize.mockRejectedValueOnce(
      new Error("Whisper load failed"),
    );
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();
    await controller.start("dashboard");
    fakes.emitAudioInput();

    fakes.emitFinal("open dashboard", 81);

    await vi.waitFor(() => expect(controller.getSnapshot().history).toHaveLength(1));
    expect(controller.getSnapshot().history[0].moonshine?.transcript).toBe(
      "open dashboard",
    );
    expect(controller.getSnapshot().history[0].whisper).toBeNull();
    expect(controller.getSnapshot().whisperStatus).toBe("error");
    expect(controller.getSnapshot().whisperError).toBe("Whisper load failed");
  });

  it("shows partial transcript while recording", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();
    await controller.start();

    fakes.emitPartial("open dash");

    expect(controller.getSnapshot().currentRun?.partialTranscript).toBe(
      "open dash",
    );
  });

  it("auto-stops and flushes Moonshine after speech followed by silence", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();
    await controller.start();
    fakes.moonshineSession.finalOnStop = {
      text: "open workload",
      sttCompletionTimeMs: 70,
      lineId: "line-stop",
    };
    fakes.emitAudioInput(Float32Array.from([0.25, -0.25]));
    fakes.advanceTime(1_100);

    fakes.emitAudioInput(Float32Array.from([0.001, -0.001]));

    await vi.waitFor(() => expect(controller.getSnapshot().history).toHaveLength(1));
    expect(fakes.moonshineSession.stopCalls).toBe(1);
    expect(controller.getSnapshot().history[0].moonshine?.intent.pageId).toBe(
      "workload",
    );
    expect(controller.getSnapshot().diagnosticLogs.map((entry) => entry.message)).toContain(
      "Silence detected; stopping recording",
    );
  });

  it("does not auto-stop on silence before speech is detected", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();
    await controller.start();
    fakes.advanceTime(2_000);

    fakes.emitAudioInput(Float32Array.from([0.001, -0.001]));
    await Promise.resolve();

    expect(fakes.moonshineSession.stopCalls).toBe(0);
  });

  it("does not allow model selection while recording", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();
    await controller.start();

    await controller.selectModel("medium-streaming");

    expect(controller.getSnapshot().selectedModel).toBe("small-streaming");
    expect(fakes.dependencies.moonshine.initialize).toHaveBeenCalledTimes(1);
  });

  it("passes selected audio quality settings to microphone capture", async () => {
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

  it("cleans up the Moonshine stream when microphone start fails", async () => {
    const fakes = createFakes();
    fakes.dependencies.audioCapture.start = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();

    await expect(controller.start()).rejects.toThrow("permission denied");

    expect(fakes.moonshineSession.stopCalls).toBe(1);
    expect(controller.getSnapshot().status).toBe("error");
  });

  it("stops microphone and Moonshine when capture reports an error", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);
    await controller.initializeModels();
    await controller.start();

    fakes.audioSession.callbacks?.onError?.(
      new SpeechServiceError("recognition-failed", "audio device disconnected"),
    );

    await vi.waitFor(() => expect(fakes.audioSession.stopCalls).toBe(1));
    expect(fakes.moonshineSession.stopCalls).toBe(1);
    expect(controller.getSnapshot().status).toBe("error");
  });
});

function createFakes() {
  let nowValue = 1_000;
  let timeoutId = 0;
  const timeoutCallbacks = new Map<number, () => void>();
  const audioSession = new FakeAudioSession();
  const moonshineSession = new FakeMoonshineSession();
  let moonshineCallbacks: SpeechRecognitionCallbacks | null = null;
  let whisperTranscript = "";

  const dependencies = {
    now: () => {
      nowValue += 10;
      return nowValue;
    },
    setTimeout: (callback: () => void) => {
      timeoutId += 1;
      timeoutCallbacks.set(timeoutId, callback);
      return timeoutId;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      timeoutCallbacks.delete(Number(id));
    },
    audioCapture: {
      start: vi.fn(async (callbacks?: AudioCaptureCallbacks) => {
        audioSession.setCallbacks(callbacks);
        return audioSession;
      }),
    },
    moonshine: {
      initialize: vi.fn(async (_variant: MoonshineModelVariant) => undefined),
      beginStream: vi.fn(async (
        callbacks: SpeechRecognitionCallbacks,
        _variant: MoonshineModelVariant,
      ) => {
        moonshineCallbacks = callbacks;
        moonshineSession.callbacks = callbacks;
        return moonshineSession;
      }),
      stopListening: vi.fn(async () => moonshineSession.stop()),
      onModelProgress: vi.fn(),
    },
    whisper: {
      initialize: vi.fn(async () => undefined),
      transcribe: vi.fn(async (_pcm: Float32Array, requestId: string) => {
        const inferenceStartedAt = nowValue + 10;
        nowValue += 40;
        return {
          requestId,
          text: whisperTranscript,
          inferenceStartedAt,
          transcriptReadyAt: nowValue,
          inferenceTimeMs: nowValue - inferenceStartedAt,
        };
      }),
    },
  };

  return {
    dependencies,
    audioSession,
    moonshineSession,
    advanceTime(ms: number) {
      nowValue += ms;
    },
    emitAudioInput(chunk = Float32Array.from([0.1, 0.2])) {
      audioSession.emitInput(chunk);
    },
    emitPartial(text: string) {
      moonshineCallbacks?.onPartialTranscript?.(text);
    },
    emitFinal(text: string, sttCompletionTimeMs: number) {
      whisperTranscript = text;
      moonshineCallbacks?.onFinalTranscript?.({
        text,
        sttCompletionTimeMs,
        lineId: "line-final",
      });
    },
  };
}

class FakeAudioSession implements AudioCaptureSession {
  stopped = false;
  stopCalls = 0;
  callbacks?: AudioCaptureCallbacks;
  private readonly chunks: Float32Array[] = [];

  setCallbacks(callbacks?: AudioCaptureCallbacks): void {
    this.callbacks = callbacks;
  }

  emitInput(chunk: Float32Array): void {
    this.chunks.push(new Float32Array(chunk));
    this.callbacks?.onInputLevel?.({
      rms: calculateInputVolume(chunk),
      peak: calculateInputPeakVolume(chunk),
    });
    this.callbacks?.onVolume?.(calculateInputVolume(chunk));
    this.callbacks?.onChunk?.(chunk);
  }

  addConsumer(): () => void {
    return () => undefined;
  }

  async stop(): Promise<Float32Array> {
    this.stopCalls += 1;
    this.stopped = true;
    return Float32Array.from(this.chunks.flatMap((chunk) => Array.from(chunk)));
  }
}

class FakeMoonshineSession {
  stopped = false;
  stopCalls = 0;
  acceptedAudio: Float32Array[] = [];
  callbacks: SpeechRecognitionCallbacks | null = null;
  finalOnStop: FinalTranscriptResult | null = null;

  acceptAudio(chunk: Float32Array): void {
    this.acceptedAudio.push(chunk);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopCalls += 1;
    this.finalOnStop && this.callbacks?.onFinalTranscript?.(this.finalOnStop);
    this.stopped = true;
  }
}
