import {
  addBenchmarkHistoryItem,
  createModelBenchmarkResult,
  summarizeBenchmarkHistory,
} from "./benchmarkMetrics";
import {
  audioCaptureService,
  DEFAULT_AUDIO_PROCESSING_CONFIG,
  type AudioCaptureService,
  type AudioCaptureSession,
  type AudioInputLevel,
  type AudioProcessingConfig,
} from "./audioCaptureService";
import {
  DEFAULT_MOONSHINE_MODEL,
  MOONSHINE_MODELS,
  moonshineService,
  type FinalTranscriptResult,
  type MoonshineModelVariant,
  type MoonshineService,
  type MoonshineStreamSession,
  type SpeechServiceError,
} from "./moonshineService";
import type {
  BenchmarkHistoryRun,
  BenchmarkSummary,
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
type DiagnosticLogLevel = "info" | "warn" | "error";

const VAD_RMS_SPEECH_THRESHOLD = 0.035;
const VAD_PEAK_SPEECH_THRESHOLD = 0.12;
const VAD_SILENCE_DURATION_MS = 1_000;
const VAD_MIN_RECORDING_MS = 600;

export interface MoonshineProgress {
  fraction: number;
  file: string;
  loaded: number;
  total?: number;
}

export interface DiagnosticLogEntry {
  id: string;
  at: number;
  level: DiagnosticLogLevel;
  message: string;
}

export interface BenchmarkCurrentRun extends BenchmarkHistoryRun {
  status: RunStatus;
  partialTranscript: string;
  error: string | null;
}

export interface BenchmarkSnapshot {
  status: RunStatus;
  selectedModel: MoonshineModelVariant;
  moonshineStatus: ModelStatus;
  moonshineError: string | null;
  moonshineProgress: MoonshineProgress | null;
  inputVolume: number;
  inputPeakVolume: number;
  audioProcessingConfig: AudioProcessingConfig;
  diagnosticLogs: DiagnosticLogEntry[];
  currentRun: BenchmarkCurrentRun | null;
  history: BenchmarkHistoryRun[];
  summary: BenchmarkSummary;
}

export interface BenchmarkControllerDependencies {
  now: () => number;
  setTimeout: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
  audioCapture: Pick<AudioCaptureService, "start">;
  moonshine: Pick<
    MoonshineService,
    "initialize" | "beginStream" | "stopListening" | "onModelProgress"
  >;
}

const DEFAULT_DEPENDENCIES: BenchmarkControllerDependencies = {
  now: performance.now.bind(performance),
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  audioCapture: audioCaptureService,
  moonshine: moonshineService,
};

export class BenchmarkController {
  private snapshot: BenchmarkSnapshot = {
    status: "idle",
    selectedModel: DEFAULT_MOONSHINE_MODEL,
    moonshineStatus: "idle",
    moonshineError: null,
    moonshineProgress: null,
    inputVolume: 0,
    inputPeakVolume: 0,
    audioProcessingConfig: DEFAULT_AUDIO_PROCESSING_CONFIG,
    diagnosticLogs: [],
    currentRun: null,
    history: [],
    summary: summarizeBenchmarkHistory([]),
  };
  private readonly listeners = new Set<(snapshot: BenchmarkSnapshot) => void>();
  private runCounter = 0;
  private modelLoadRequest = 0;
  private activeRunId: string | null = null;
  private audioSession: AudioCaptureSession | null = null;
  private moonshineSession: MoonshineStreamSession | null = null;
  private moonshineAudioReceivedAt: number | null = null;
  private finalAccepted = false;
  private finalHandlingPromise: Promise<void> | null = null;
  private vadSpeechDetected = false;
  private vadLastSpeechAt: number | null = null;
  private vadStopRequested = false;
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
      diagnosticLogs: [...this.snapshot.diagnosticLogs],
    };
  }

  updateAudioProcessingConfig(patch: Partial<AudioProcessingConfig>): void {
    if (this.isRunning()) return;
    this.patch({
      audioProcessingConfig: {
        ...this.snapshot.audioProcessingConfig,
        ...patch,
      },
    });
  }

  async initializeModels(): Promise<void> {
    await this.loadSelectedModel(this.snapshot.selectedModel);
  }

  async selectModel(variant: MoonshineModelVariant): Promise<void> {
    if (this.isRunning() || variant === this.snapshot.selectedModel) return;
    this.patch({ selectedModel: variant });
    await this.loadSelectedModel(variant);
  }

  private async loadSelectedModel(variant: MoonshineModelVariant): Promise<void> {
    const request = ++this.modelLoadRequest;
    this.patch({
      status: "loading-models",
      moonshineStatus: "loading",
      moonshineError: null,
      moonshineProgress: null,
    });
    this.addLog("info", `Loading ${MOONSHINE_MODELS[variant].name}`);
    this.dependencies.moonshine.onModelProgress(
      (fraction, file, bytes) => {
        if (request !== this.modelLoadRequest) return;
        this.patch({
          moonshineProgress: {
            fraction,
            file,
            loaded: bytes?.loaded ?? 0,
            total: bytes?.total,
          },
        });
      },
    );

    try {
      await this.dependencies.moonshine.initialize(variant);
      if (request !== this.modelLoadRequest) return;
      this.patch({
        status: "ready",
        moonshineStatus: "ready",
        moonshineError: null,
      });
      this.addLog("info", `${MOONSHINE_MODELS[variant].name} ready`);
    } catch (error) {
      if (request !== this.modelLoadRequest) return;
      this.patch({
        status: "error",
        moonshineStatus: "error",
        moonshineError: errorMessage(error),
      });
      this.addLog(
        "error",
        `${MOONSHINE_MODELS[variant].name} failed: ${errorMessage(error)}`,
      );
    }
  }

  async start(expectedPageId: string | null = null): Promise<void> {
    if (this.snapshot.moonshineStatus !== "ready" || this.isRunning()) return;

    const runId = `run-${++this.runCounter}`;
    const startedAt = this.dependencies.now();
    const modelVariant = this.snapshot.selectedModel;
    this.activeRunId = runId;
    this.moonshineAudioReceivedAt = null;
    this.finalAccepted = false;
    this.finalHandlingPromise = null;
    this.resetVadState();
    this.patch({
      status: "recording",
      currentRun: {
        id: runId,
        startedAt,
        stoppedAt: startedAt,
        expectedPageId,
        modelVariant,
        moonshine: null,
        whisper: null,
        status: "recording",
        partialTranscript: "",
        error: null,
      },
    });
    this.addLog(
      "info",
      `Starting ${MOONSHINE_MODELS[modelVariant].name} run ${runId}`,
    );

    try {
      this.moonshineSession = await this.dependencies.moonshine.beginStream(
        {
          onPartialTranscript: (text) => {
            if (this.activeRunId === runId && !this.finalAccepted) {
              this.updateCurrentRun({ partialTranscript: text });
            }
          },
          onFinalTranscript: (result) => {
            if (this.activeRunId !== runId || this.finalAccepted) return;
            this.finalHandlingPromise = this.handleMoonshineFinal(runId, result);
          },
          onError: (error) => this.handleRecognitionError(runId, error),
        },
        modelVariant,
      );

      this.audioSession = await this.dependencies.audioCapture.start({
        audioProcessingConfig: this.snapshot.audioProcessingConfig,
        onChunk: (chunk) => {
          if (this.activeRunId !== runId || !this.moonshineSession) return;
          if (this.moonshineAudioReceivedAt === null) {
            this.moonshineAudioReceivedAt = this.dependencies.now();
            this.addLog("info", "First audio chunk sent to Moonshine");
          }
          this.moonshineSession.acceptAudio(chunk);
        },
        onVolume: (level) => {
          if (this.activeRunId === runId) this.patch({ inputVolume: level });
        },
        onInputLevel: (level) => {
          if (this.activeRunId !== runId) return;
          this.patch({ inputVolume: level.rms, inputPeakVolume: level.peak });
          this.handleVadLevel(runId, level);
        },
        onError: (error) => this.handleRecognitionError(runId, error),
      });
      this.addLog("info", "Microphone capture started");
      this.timeoutId = this.dependencies.setTimeout(() => {
        this.addLog("warn", "Auto-stopping benchmark after 15 seconds");
        void this.stop();
      }, 15_000);
    } catch (error) {
      await this.moonshineSession?.stop().catch(() => undefined);
      this.moonshineSession = null;
      this.audioSession = null;
      this.activeRunId = null;
      this.updateCurrentRun({ error: errorMessage(error), status: "error" });
      this.patch({ status: "error" });
      this.addLog("error", `Failed to start benchmark: ${errorMessage(error)}`);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const runId = this.activeRunId;
    if (!runId) return;
    this.clearRecordingTimeout();
    this.patch({ status: "transcribing" });
    this.updateCurrentRun({ status: "transcribing" });

    const session = this.moonshineSession;
    this.moonshineSession = null;
    await session?.stop().catch((error) => {
      this.handleRecognitionError(runId, error);
    });
    await this.finalHandlingPromise;

    if (this.activeRunId === runId && !this.finalAccepted) {
      await this.stopAudioCapture(runId);
      this.updateCurrentRun({
        error: "Moonshine did not return a final transcript.",
        status: "error",
      });
      this.patch({ status: "error" });
      this.addLog("error", "Moonshine did not return a final transcript");
    }
  }

  async reset(): Promise<void> {
    this.activeRunId = null;
    this.finalAccepted = true;
    this.clearRecordingTimeout();
    await this.audioSession?.stop().catch(() => undefined);
    await this.moonshineSession?.stop().catch(() => undefined);
    this.audioSession = null;
    this.moonshineSession = null;
    this.moonshineAudioReceivedAt = null;
    this.finalHandlingPromise = null;
    this.resetVadState();
    this.patch({
      status: this.snapshot.moonshineStatus === "ready" ? "ready" : "idle",
      inputVolume: 0,
      inputPeakVolume: 0,
      currentRun: null,
      history: [],
      summary: summarizeBenchmarkHistory([]),
      diagnosticLogs: [],
    });
    this.addLog("info", "Reset benchmark state");
  }

  private async handleMoonshineFinal(
    runId: string,
    final: FinalTranscriptResult,
  ): Promise<void> {
    if (this.activeRunId !== runId || !this.snapshot.currentRun) return;
    this.finalAccepted = true;
    const modelResultReadyAt = this.dependencies.now();
    this.clearRecordingTimeout();
    this.moonshineSession = null;
    await this.stopAudioCapture(runId);
    if (this.activeRunId !== runId || !this.snapshot.currentRun) return;

    const result = createModelBenchmarkResult({
      modelId: "moonshine",
      modelVariant: this.snapshot.currentRun.modelVariant ?? DEFAULT_MOONSHINE_MODEL,
      transcript: final.text,
      lineId: final.lineId,
      recordingStartedAt: this.snapshot.currentRun.startedAt,
      recordingStoppedAt: this.snapshot.currentRun.stoppedAt,
      transcriptReadyAt: modelResultReadyAt,
      sttCompletionTimeMs: final.sttCompletionTimeMs,
      inferenceStartedAt: null,
      modelAudioReceivedAt:
        this.moonshineAudioReceivedAt ?? this.snapshot.currentRun.startedAt,
      modelResultReadyAt,
      expectedPageId: this.snapshot.currentRun.expectedPageId,
      now: this.dependencies.now,
    });
    this.updateCurrentRun({ moonshine: result, partialTranscript: "" });
    this.addLog("info", `Moonshine final: "${final.text}"`);
    this.completeRun();
  }

  private async stopAudioCapture(runId: string): Promise<void> {
    const audioSession = this.audioSession;
    this.audioSession = null;
    if (audioSession) await audioSession.stop();
    const stoppedAt = this.dependencies.now();
    if (this.activeRunId !== runId || !this.snapshot.currentRun) return;
    this.updateCurrentRun({ stoppedAt, status: "transcribing" });
    this.patch({ status: "transcribing", inputVolume: 0, inputPeakVolume: 0 });
    this.addLog("info", "Microphone capture stopped");
  }

  private completeRun(): void {
    const run = this.snapshot.currentRun;
    if (!run?.moonshine) return;
    const completed: BenchmarkHistoryRun = {
      id: run.id,
      startedAt: run.startedAt,
      stoppedAt: run.stoppedAt,
      expectedPageId: run.expectedPageId,
      modelVariant: run.modelVariant,
      moonshine: run.moonshine,
      whisper: null,
    };
    const history = addBenchmarkHistoryItem(this.snapshot.history, completed);
    this.activeRunId = null;
    this.moonshineAudioReceivedAt = null;
    this.finalHandlingPromise = null;
    this.resetVadState();
    this.patch({
      status: "complete",
      currentRun: { ...run, status: "complete" },
      history,
      summary: summarizeBenchmarkHistory(history),
    });
  }

  private handleRecognitionError(runId: string, error: Error | SpeechServiceError): void {
    if (this.activeRunId !== runId) return;
    this.activeRunId = null;
    this.finalAccepted = true;
    this.clearRecordingTimeout();
    const audioSession = this.audioSession;
    const moonshineSession = this.moonshineSession;
    this.audioSession = null;
    this.moonshineSession = null;
    this.updateCurrentRun({ error: error.message, status: "error" });
    this.patch({ status: "error", inputVolume: 0, inputPeakVolume: 0 });
    this.addLog("error", `Moonshine error: ${error.message}`);
    void Promise.all([
      audioSession?.stop().catch(() => undefined),
      moonshineSession?.stop().catch(() => undefined),
    ]);
  }

  private handleVadLevel(runId: string, level: AudioInputLevel): void {
    if (
      this.activeRunId !== runId ||
      !this.snapshot.currentRun ||
      this.snapshot.status !== "recording" ||
      this.vadStopRequested
    ) {
      return;
    }

    const now = this.dependencies.now();
    const isSpeech =
      level.rms >= VAD_RMS_SPEECH_THRESHOLD ||
      level.peak >= VAD_PEAK_SPEECH_THRESHOLD;
    if (isSpeech) {
      this.vadLastSpeechAt = now;
      if (!this.vadSpeechDetected) {
        this.vadSpeechDetected = true;
        this.addLog("info", "Speech detected");
      }
      return;
    }
    if (!this.vadSpeechDetected || this.vadLastSpeechAt === null) return;

    if (
      now - this.vadLastSpeechAt >= VAD_SILENCE_DURATION_MS &&
      now - this.snapshot.currentRun.startedAt >= VAD_MIN_RECORDING_MS
    ) {
      this.vadStopRequested = true;
      this.addLog("info", "Silence detected; stopping recording");
      void this.stop();
    }
  }

  private updateCurrentRun(patch: Partial<BenchmarkCurrentRun>): void {
    if (!this.snapshot.currentRun) return;
    this.patch({ currentRun: { ...this.snapshot.currentRun, ...patch } });
  }

  private isRunning(): boolean {
    return this.snapshot.status === "recording" || this.snapshot.status === "transcribing";
  }

  private clearRecordingTimeout(): void {
    if (this.timeoutId) this.dependencies.clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  private resetVadState(): void {
    this.vadSpeechDetected = false;
    this.vadLastSpeechAt = null;
    this.vadStopRequested = false;
  }

  private addLog(level: DiagnosticLogLevel, message: string): void {
    const at = this.dependencies.now();
    const entry: DiagnosticLogEntry = {
      id: `log-${at}-${this.snapshot.diagnosticLogs.length}`,
      at,
      level,
      message,
    };
    this.patch({
      diagnosticLogs: [...this.snapshot.diagnosticLogs, entry].slice(-80),
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
