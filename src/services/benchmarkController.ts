import {
  addBenchmarkHistoryItem,
  createModelBenchmarkResult,
  summarizeBenchmarkHistory,
} from "./benchmarkMetrics";
import {
  audioCaptureService,
  DEFAULT_AUDIO_PROCESSING_CONFIG,
  type AudioProcessingConfig,
  type AudioCaptureService,
  type AudioCaptureSession,
} from "./audioCaptureService";
import {
  moonshineService,
  type MoonshineService,
  type MoonshineStreamSession,
  type SpeechRecognitionCallbacks,
  type SpeechServiceError,
} from "./moonshineService";
import {
  whisperService,
  type WhisperProgress,
  type WhisperService,
} from "./whisperService";
import type {
  BenchmarkHistoryRun,
  BenchmarkSummary,
  ModelBenchmarkResult,
} from "../types/navigation";

type RunStatus =
  | "idle"
  | "loading-models"
  | "ready"
  | "recording"
  | "transcribing"
  | "complete"
  | "error";

type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface BenchmarkCurrentRun extends BenchmarkHistoryRun {
  status: RunStatus;
  partialTranscript: string;
  error: string | null;
}

export interface BenchmarkSnapshot {
  status: RunStatus;
  moonshineStatus: ModelStatus;
  whisperStatus: ModelStatus;
  moonshineError: string | null;
  whisperError: string | null;
  whisperProgress: WhisperProgress | null;
  inputVolume: number;
  inputPeakVolume: number;
  audioProcessingConfig: AudioProcessingConfig;
  currentRun: BenchmarkCurrentRun | null;
  history: BenchmarkHistoryRun[];
  summary: BenchmarkSummary;
}

export interface BenchmarkControllerDependencies {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
  audioCapture: Pick<AudioCaptureService, "start">;
  moonshine: Pick<
    MoonshineService,
    "initialize" | "beginStream" | "stopListening" | "onModelProgress"
  >;
  whisper: Pick<WhisperService, "initialize" | "transcribe">;
}

const DEFAULT_DEPENDENCIES: BenchmarkControllerDependencies = {
  now: performance.now.bind(performance),
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  audioCapture: audioCaptureService,
  moonshine: moonshineService,
  whisper: whisperService,
};

export class BenchmarkController {
  private snapshot: BenchmarkSnapshot = {
    status: "idle",
    moonshineStatus: "idle",
    whisperStatus: "idle",
    moonshineError: null,
    whisperError: null,
    whisperProgress: null,
    inputVolume: 0,
    inputPeakVolume: 0,
    audioProcessingConfig: DEFAULT_AUDIO_PROCESSING_CONFIG,
    currentRun: null,
    history: [],
    summary: summarizeBenchmarkHistory([]),
  };
  private listeners = new Set<(snapshot: BenchmarkSnapshot) => void>();
  private runCounter = 0;
  private activeRunId: string | null = null;
  private audioSession: AudioCaptureSession | null = null;
  private moonshineSession: MoonshineStreamSession | null = null;
  private moonshineAudioReceivedAt: number | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dependencies: BenchmarkControllerDependencies =
      DEFAULT_DEPENDENCIES,
  ) {}

  subscribe(listener: (snapshot: BenchmarkSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): BenchmarkSnapshot {
    return {
      ...this.snapshot,
      history: [...this.snapshot.history],
      currentRun: this.snapshot.currentRun
        ? { ...this.snapshot.currentRun }
        : null,
      audioProcessingConfig: { ...this.snapshot.audioProcessingConfig },
    };
  }

  updateAudioProcessingConfig(patch: Partial<AudioProcessingConfig>): void {
    if (this.snapshot.status === "recording" || this.snapshot.status === "transcribing") {
      return;
    }

    this.patch({
      audioProcessingConfig: {
        ...this.snapshot.audioProcessingConfig,
        ...patch,
      },
    });
  }

  async initializeModels(): Promise<void> {
    this.patch({
      status: "loading-models",
      moonshineStatus: "loading",
      whisperStatus: "idle",
      moonshineError: null,
      whisperError: null,
      inputVolume: 0,
      inputPeakVolume: 0,
    });

    try {
      await this.dependencies.moonshine.initialize();
      this.patch({
        status: "ready",
        moonshineStatus: "ready",
        moonshineError: null,
      });
    } catch (error) {
      this.patch({
        status: "error",
        moonshineStatus: "error",
        moonshineError: errorMessage(error),
      });
    }
  }

  async start(expectedPageId: string | null = null): Promise<void> {
    if (this.snapshot.moonshineStatus !== "ready") return;

    const runId = `run-${++this.runCounter}`;
    const startedAt = this.dependencies.now();
    this.activeRunId = runId;
    this.moonshineAudioReceivedAt = null;
    this.patch({
      status: "recording",
      currentRun: {
        id: runId,
        startedAt,
        stoppedAt: startedAt,
        expectedPageId,
        moonshine: null,
        whisper: null,
        status: "recording",
        partialTranscript: "",
        error: null,
      },
    });

    const callbacks: SpeechRecognitionCallbacks = {
      onPartialTranscript: (text) => {
        if (this.activeRunId !== runId) return;
        this.updateCurrentRun({ partialTranscript: text });
      },
      onFinalTranscript: (finalTranscript) => {
        void this.handleMoonshineFinal(runId, finalTranscript.text, {
          lineId: finalTranscript.lineId,
          sttCompletionTimeMs: finalTranscript.sttCompletionTimeMs,
        });
      },
      onError: (error: SpeechServiceError) => {
        if (this.activeRunId !== runId) return;
        this.updateCurrentRun({ error: error.message, status: "error" });
        this.patch({ status: "error" });
      },
    };

    try {
      this.moonshineSession = await this.dependencies.moonshine.beginStream(callbacks);
      this.audioSession = await this.dependencies.audioCapture.start({
        audioProcessingConfig: this.snapshot.audioProcessingConfig,
        onChunk: (chunk) => {
          if (this.activeRunId === runId && this.moonshineAudioReceivedAt === null) {
            this.moonshineAudioReceivedAt = this.dependencies.now();
          }
          this.moonshineSession?.acceptAudio(chunk);
        },
        onVolume: (level) => {
          if (this.activeRunId === runId) this.patch({ inputVolume: level });
        },
        onInputLevel: (level) => {
          if (this.activeRunId === runId) {
            this.patch({ inputVolume: level.rms, inputPeakVolume: level.peak });
          }
        },
        onError: (error) => {
          if (this.activeRunId === runId) {
            this.updateCurrentRun({ error: error.message, status: "error" });
          }
        },
      });
      this.timeoutId = this.dependencies.setTimeout(() => {
        void this.stop();
      }, 15_000);
    } catch (error) {
      await this.moonshineSession?.stop().catch(() => undefined);
      this.moonshineSession = null;
      this.audioSession = null;
      this.activeRunId = null;
      this.moonshineAudioReceivedAt = null;
      this.updateCurrentRun({ error: errorMessage(error), status: "error" });
      this.patch({ status: "error" });
      throw error;
    }
  }

  async stop(): Promise<void> {
    const runId = this.activeRunId;
    if (!runId || !this.audioSession) return;
    await this.stopRecording(runId);
    if (this.activeRunId !== runId || !this.snapshot.currentRun) return;
    if (!this.snapshot.currentRun.moonshine) {
      this.activeRunId = null;
      this.moonshineAudioReceivedAt = null;
      this.updateCurrentRun({
        error: "Stopped before Moonshine returned a final transcript.",
        status: "complete",
      });
      this.patch({ status: "complete" });
    }
  }

  async reset(): Promise<void> {
    this.activeRunId = null;
    this.moonshineAudioReceivedAt = null;
    if (this.timeoutId) this.dependencies.clearTimeout(this.timeoutId);
    this.timeoutId = null;
    await this.audioSession?.stop().catch(() => undefined);
    await this.moonshineSession?.stop().catch(() => undefined);
    this.audioSession = null;
    this.moonshineSession = null;
    this.patch({
      status: this.snapshot.moonshineStatus === "ready" ? "ready" : "idle",
      inputVolume: 0,
      inputPeakVolume: 0,
      currentRun: null,
      history: [],
      summary: summarizeBenchmarkHistory([]),
    });
  }

  private async handleMoonshineFinal(
    runId: string,
    transcript: string,
    options: { lineId: string; sttCompletionTimeMs: number },
  ): Promise<void> {
    if (this.activeRunId !== runId || !this.snapshot.currentRun) return;

    const transcriptReadyAt = this.dependencies.now();
    const pcm = await this.stopRecording(runId);
    const stoppedAt = this.snapshot.currentRun?.stoppedAt ?? transcriptReadyAt;
    if (this.activeRunId !== runId && this.snapshot.currentRun?.id !== runId) return;

    const result = createModelBenchmarkResult({
      modelId: "moonshine",
      transcript,
      lineId: options.lineId,
      recordingStartedAt: this.snapshot.currentRun.startedAt,
      recordingStoppedAt: stoppedAt,
      transcriptReadyAt,
      sttCompletionTimeMs: options.sttCompletionTimeMs,
      inferenceStartedAt: null,
      modelAudioReceivedAt:
        this.moonshineAudioReceivedAt ?? this.snapshot.currentRun.startedAt,
      modelResultReadyAt: transcriptReadyAt,
      expectedPageId: this.snapshot.currentRun.expectedPageId,
      now: this.dependencies.now,
    });

    this.updateCurrentRun({ moonshine: result, partialTranscript: "" });
    if (pcm.length === 0) {
      this.completeRunIfReady(true);
      return;
    }

    const whisperReady = await this.ensureWhisperReady();
    if (this.activeRunId !== runId || !this.snapshot.currentRun) return;
    if (!whisperReady) {
      this.completeRunIfReady(true);
      return;
    }

    void this.runWhisper(runId, pcm);
  }

  private async stopRecording(runId: string): Promise<Float32Array> {
    if (this.timeoutId) this.dependencies.clearTimeout(this.timeoutId);
    this.timeoutId = null;
    const audioSession = this.audioSession;
    this.audioSession = null;
    await this.moonshineSession?.stop().catch(() => undefined);
    this.moonshineSession = null;
    if (!audioSession) return new Float32Array();

    const pcm = await audioSession.stop();
    const stoppedAt = this.dependencies.now();
    if (this.activeRunId !== runId || !this.snapshot.currentRun) return pcm;

    this.updateCurrentRun({ stoppedAt, status: "transcribing" });
    this.patch({ status: "transcribing", inputVolume: 0, inputPeakVolume: 0 });

    return pcm;
  }

  private async ensureWhisperReady(): Promise<boolean> {
    if (this.snapshot.whisperStatus === "ready") return true;

    this.patch({
      whisperStatus: "loading",
      whisperError: null,
      whisperProgress: null,
    });

    try {
      await this.dependencies.whisper.initialize({
        onProgress: (progress) => {
          this.patch({ whisperProgress: progress });
        },
      });
      this.patch({ whisperStatus: "ready", whisperError: null });
      return true;
    } catch (error) {
      this.patch({
        whisperStatus: "error",
        whisperError: errorMessage(error),
      });
      return false;
    }
  }

  private async runWhisper(runId: string, pcm: Float32Array): Promise<void> {
    if (!this.snapshot.currentRun?.moonshine) return;

    try {
      const modelAudioReceivedAt = this.dependencies.now();
      const whisperResult = await this.dependencies.whisper.transcribe(pcm, runId);
      if (this.activeRunId !== runId || !this.snapshot.currentRun) return;
      const modelResultReadyAt = this.dependencies.now();
      const result = createModelBenchmarkResult({
        modelId: "whisper",
        transcript: whisperResult.text,
        lineId: whisperResult.requestId,
        recordingStartedAt: this.snapshot.currentRun.startedAt,
        recordingStoppedAt: this.snapshot.currentRun.stoppedAt,
        transcriptReadyAt: whisperResult.transcriptReadyAt,
        sttCompletionTimeMs: null,
        inferenceStartedAt: whisperResult.inferenceStartedAt,
        modelAudioReceivedAt,
        modelResultReadyAt,
        expectedPageId: this.snapshot.currentRun.expectedPageId,
        now: this.dependencies.now,
      });
      this.updateCurrentRun({ whisper: result });
      this.completeRunIfReady(true);
    } catch (error) {
      if (this.activeRunId !== runId) return;
      this.updateCurrentRun({ error: errorMessage(error), status: "error" });
      this.completeRunIfReady(true);
    }
  }

  private completeRunIfReady(allowMissingWhisper: boolean): void {
    const run = this.snapshot.currentRun;
    if (!run || (!run.moonshine && !run.whisper)) return;
    if (!allowMissingWhisper && !run.whisper) return;

    const completed: BenchmarkHistoryRun = {
      id: run.id,
      startedAt: run.startedAt,
      stoppedAt: run.stoppedAt,
      expectedPageId: run.expectedPageId,
      moonshine: run.moonshine,
      whisper: run.whisper,
    };
    const history = addBenchmarkHistoryItem(this.snapshot.history, completed);
    this.activeRunId = null;
    this.moonshineAudioReceivedAt = null;
    this.patch({
      status: "complete",
      currentRun: { ...run, status: "complete" },
      history,
      summary: summarizeBenchmarkHistory(history),
    });
  }

  private updateCurrentRun(patch: Partial<BenchmarkCurrentRun>): void {
    if (!this.snapshot.currentRun) return;
    this.patch({
      currentRun: {
        ...this.snapshot.currentRun,
        ...patch,
      },
    });
  }

  private patch(next: Partial<BenchmarkSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
