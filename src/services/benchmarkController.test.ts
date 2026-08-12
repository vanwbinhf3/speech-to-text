import { describe, expect, it, vi } from "vitest";

import { BenchmarkController } from "./benchmarkController";
import {
  calculateInputPeakVolume,
  calculateInputVolume,
  type AudioCaptureCallbacks,
  type AudioCaptureSession,
} from "./audioCaptureService";
import type { SpeechRecognitionCallbacks } from "./moonshineService";
import type { WhisperTranscriptResult } from "./whisperService";

describe("BenchmarkController", () => {
  it("loads only Whisper and leaves Moonshine disabled", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();

    expect(fakes.dependencies.whisper.initialize).toHaveBeenCalledTimes(1);
    expect(fakes.dependencies.moonshine.initialize).not.toHaveBeenCalled();
    expect(controller.getSnapshot().whisperStatus).toBe("ready");
    expect(controller.getSnapshot().moonshineStatus).toBe("idle");
  });

  it("records audio and transcribes with Whisper after manual stop", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    fakes.emitAudioInput();
    await controller.stop();

    expect(fakes.dependencies.moonshine.beginStream).not.toHaveBeenCalled();
    expect(fakes.audioSession.stopCalls).toBe(1);
    expect(fakes.whisperTranscribeCalls).toHaveLength(1);

    fakes.resolveWhisper("open dashboard");

    await vi.waitFor(() => expect(controller.getSnapshot().history).toHaveLength(1));
    expect(controller.getSnapshot().history[0].moonshine).toBeNull();
    expect(controller.getSnapshot().history[0].whisper?.intent.pageId).toBe("dashboard");
  });

  it("records Whisper model timer from audio handoff to result", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    fakes.emitAudioInput();
    await controller.stop();
    fakes.resolveWhisper("open dashboard");

    await vi.waitFor(() => expect(controller.getSnapshot().history).toHaveLength(1));
    const result = controller.getSnapshot().history[0].whisper;

    expect(result?.metrics.modelResultReadyAt).toBeGreaterThan(
      result?.metrics.modelAudioReceivedAt ?? 0,
    );
    expect(result?.metrics.modelProcessingTimeMs).toBe(
      (result?.metrics.modelResultReadyAt ?? 0) -
        (result?.metrics.modelAudioReceivedAt ?? 0),
    );
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

  it("auto-stops after speech is followed by enough silence", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    fakes.emitAudioInput(Float32Array.from([0.25, -0.25]));
    fakes.advanceTime(1_100);
    fakes.emitAudioInput(Float32Array.from([0.001, -0.001]));

    await vi.waitFor(() => expect(fakes.audioSession.stopCalls).toBe(1));
    expect(fakes.whisperTranscribeCalls).toHaveLength(1);
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

    expect(fakes.audioSession.stopCalls).toBe(0);
    expect(fakes.whisperTranscribeCalls).toHaveLength(0);
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

  it("records diagnostic logs for microphone, audio, and Whisper", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    fakes.emitAudioInput(Float32Array.from([0.5, -0.5]));
    await controller.stop();
    fakes.resolveWhisper("open tasks");

    await vi.waitFor(() => expect(controller.getSnapshot().history).toHaveLength(1));
    const messages = controller.getSnapshot().diagnosticLogs.map((entry) => entry.message);

    expect(messages).toContain("Whisper model ready");
    expect(messages).toContain("Moonshine disabled; using Whisper-only mode");
    expect(messages).toContain("Starting benchmark run run-1");
    expect(messages).toContain("Microphone capture started");
    expect(messages).toContain("First audio chunk received");
    expect(messages).toContain("Sending captured audio to Whisper");
    expect(messages).toContain('Whisper final: "open tasks"');
  });

  it("ignores stale Whisper updates after reset", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    await controller.stop();
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
      fakes.emitAudioInput();
      await controller.stop();
      await vi.waitFor(() =>
        expect(fakes.whisperTranscribeCalls).toHaveLength(index + 1),
      );
      fakes.resolveWhisper("open dashboard");
      await vi.waitFor(() => expect(controller.getSnapshot().history[0]?.id).toBe(`run-${index + 1}`));
    }

    expect(controller.getSnapshot().history).toHaveLength(20);
    expect(controller.getSnapshot().history.at(-1)?.id).toBe("run-3");
  });

  it("shows an error and skips history when Whisper fails", async () => {
    const fakes = createFakes();
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await controller.start();
    await controller.stop();
    await vi.waitFor(() => expect(fakes.whisperTranscribeCalls).toHaveLength(1));
    fakes.rejectWhisper(new Error("worker crashed"));

    await vi.waitFor(() => expect(controller.getSnapshot().currentRun?.error).toBe("worker crashed"));
    expect(controller.getSnapshot().history).toHaveLength(0);
    expect(controller.getSnapshot().diagnosticLogs.at(-1)).toMatchObject({
      level: "error",
      message: "Whisper error: worker crashed",
    });
  });

  it("clears active run when microphone start fails", async () => {
    const fakes = createFakes();
    fakes.dependencies.audioCapture.start = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const controller = new BenchmarkController(fakes.dependencies);

    await controller.initializeModels();
    await expect(controller.start()).rejects.toThrow("permission denied");

    expect(fakes.dependencies.moonshine.beginStream).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe("error");
  });
});

function createFakes() {
  let whisperResolve:
    | ((result: WhisperTranscriptResult) => void)
    | null = null;
  let whisperReject: ((error: Error) => void) | null = null;
  let nowValue = 1_000;
  let timeoutId = 0;
  const timeoutCallbacks = new Map<number, () => void>();

  const audioSession = new FakeAudioSession();
  const whisperTranscribeCalls: Float32Array[] = [];
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
      initialize: vi.fn(async () => undefined),
      beginStream: vi.fn(async (_callbacks: SpeechRecognitionCallbacks) => new FakeMoonshineSession()),
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
    audioSession,
    whisperTranscribeCalls,
    advanceTime(ms: number) {
      nowValue += ms;
    },
    triggerTimeout(id = timeoutId) {
      timeoutCallbacks.get(id)?.();
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

class FakeMoonshineSession {
  stopped = false;

  acceptAudio(): void {}

  async stop(): Promise<void> {
    this.stopped = true;
  }
}
