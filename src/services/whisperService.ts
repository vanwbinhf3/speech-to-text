export type WhisperStatus = "idle" | "loading" | "ready" | "error";

export interface WhisperProgress {
  fraction: number;
  file: string;
  loaded?: number;
  total?: number;
}

export interface WhisperTranscriptResult {
  requestId: string;
  text: string;
  inferenceStartedAt: number;
  transcriptReadyAt: number;
  inferenceTimeMs: number;
}

export type WhisperWorkerMessage =
  | { type: "init" }
  | { type: "ready"; loadTimeMs: number; modelSizeBytes: number }
  | {
      type: "progress";
      fraction: number;
      file: string;
      loaded?: number;
      total?: number;
    }
  | {
      type: "transcribe";
      requestId: string;
      pcm: Float32Array;
      sampleRate: number;
    }
  | {
      type: "result";
      requestId: string;
      text: string;
      inferenceStartedAt: number;
      transcriptReadyAt: number;
    }
  | { type: "error"; requestId?: string; message: string };

type WorkerLike = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent<WhisperWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export interface WhisperInitializeCallbacks {
  onProgress?: (progress: WhisperProgress) => void;
}

interface PendingTranscription {
  requestId: string;
  resolve: (result: WhisperTranscriptResult) => void;
  reject: (error: Error) => void;
}

export class WhisperService {
  private worker: WorkerLike | null = null;
  private initializingPromise: Promise<void> | null = null;
  private ready = false;
  private pendingInitialization:
    | { resolve: () => void; reject: (error: Error) => void }
    | null = null;
  private pendingTranscription: PendingTranscription | null = null;
  private currentRequestId: string | null = null;
  private progressCallback?: (progress: WhisperProgress) => void;
  private loadInfo: { loadTimeMs: number; modelSizeBytes: number } | null = null;

  constructor(
    private readonly workerFactory: () => WorkerLike = createWhisperWorker,
  ) {}

  get modelInfo(): { loadTimeMs: number; modelSizeBytes: number } | null {
    return this.loadInfo;
  }

  async initialize(callbacks: WhisperInitializeCallbacks = {}): Promise<void> {
    this.progressCallback = callbacks.onProgress;
    if (this.ready) return;
    if (this.initializingPromise) return this.initializingPromise;

    this.worker = this.worker ?? this.workerFactory();
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "Whisper worker failed");
      this.pendingInitialization?.reject(error);
      this.pendingTranscription?.reject(error);
    };

    this.initializingPromise = new Promise<void>((resolve, reject) => {
      this.pendingInitialization = { resolve, reject };
      this.worker?.postMessage({ type: "init" });
    }).finally(() => {
      this.initializingPromise = null;
      this.pendingInitialization = null;
    });

    return this.initializingPromise;
  }

  async transcribe(
    pcm: Float32Array,
    requestId: string,
  ): Promise<WhisperTranscriptResult> {
    await this.initialize();

    if (this.pendingTranscription) {
      this.pendingTranscription.reject(new Error("Stale Whisper request superseded."));
    }
    this.currentRequestId = requestId;

    return new Promise<WhisperTranscriptResult>((resolve, reject) => {
      this.pendingTranscription = { requestId, resolve, reject };
      this.worker?.postMessage(
        { type: "transcribe", requestId, pcm, sampleRate: 16_000 },
        [pcm.buffer],
      );
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.initializingPromise = null;
    this.pendingInitialization = null;
    this.pendingTranscription = null;
    this.currentRequestId = null;
  }

  private handleMessage(message: WhisperWorkerMessage): void {
    if (message.type === "ready") {
      this.ready = true;
      this.loadInfo = {
        loadTimeMs: message.loadTimeMs,
        modelSizeBytes: message.modelSizeBytes,
      };
      this.pendingInitialization?.resolve();
      return;
    }

    if (message.type === "progress") {
      this.progressCallback?.({
        fraction: message.fraction,
        file: message.file,
        loaded: message.loaded,
        total: message.total,
      });
      return;
    }

    if (message.type === "result") {
      const pending = this.pendingTranscription;
      if (!pending || message.requestId !== this.currentRequestId) return;
      this.pendingTranscription = null;
      pending.resolve({
        requestId: message.requestId,
        text: message.text,
        inferenceStartedAt: message.inferenceStartedAt,
        transcriptReadyAt: message.transcriptReadyAt,
        inferenceTimeMs: message.transcriptReadyAt - message.inferenceStartedAt,
      });
      return;
    }

    if (message.type === "error") {
      const error = new Error(message.message);
      if (message.requestId) {
        if (message.requestId === this.pendingTranscription?.requestId) {
          this.pendingTranscription.reject(error);
          this.pendingTranscription = null;
        }
      } else {
        this.pendingInitialization?.reject(error);
      }
    }
  }
}

function createWhisperWorker(): WorkerLike {
  return new Worker(new URL("../workers/whisperWorker.ts", import.meta.url), {
    type: "classic",
  }) as WorkerLike;
}

export const whisperService = new WhisperService();
