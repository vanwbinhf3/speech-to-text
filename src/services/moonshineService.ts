import {
  ModelArch,
  TranscribeFlags,
  Transcriber,
  type TranscriptEventListener,
  type TranscriptLine,
} from "@moonshine-ai/moonshine-wasm";

export interface FinalTranscriptResult {
  text: string;
  sttCompletionTimeMs: number;
  lineId: string;
}

export interface SpeechRecognitionCallbacks {
  onPartialTranscript?: (text: string) => void;
  onFinalTranscript?: (result: FinalTranscriptResult) => void;
  onError?: (error: SpeechServiceError) => void;
  onListeningStateChange?: (listening: boolean) => void;
}

export type SpeechServiceErrorCode =
  | "unsupported-browser"
  | "cross-origin-isolation"
  | "permission-denied"
  | "microphone-unavailable"
  | "model-load-failed"
  | "recognition-failed";

export class SpeechServiceError extends Error {
  constructor(
    public readonly code: SpeechServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SpeechServiceError";
  }
}

interface BrowserCapabilities {
  hasWebAssembly: boolean;
  hasAudioContext: boolean;
  hasMediaDevices: boolean;
  isCrossOriginIsolated: boolean;
}

export interface RuntimeHandlers {
  onText: (text: string) => void;
  onLine: (
    line: Pick<TranscriptLine, "id" | "text" | "lastTranscriptionLatencyMs">,
  ) => void;
  onError: (error: Error) => void;
  onProgress: (
    fraction: number,
    file: string,
    bytes?: { loaded: number; total?: number },
  ) => void;
}

export type MoonshineStreamListener = TranscriptEventListener;

export interface MoonshineStreamRuntime {
  addListener(listener: MoonshineStreamListener): void;
  removeAllListeners(): void;
  start(): void;
  addAudio(audio: Float32Array, sampleRate: number): void;
  transcribe(flags?: TranscribeFlags): unknown;
  stop(): void;
  close(): void;
}

export interface TranscriberRuntime {
  createStream(): MoonshineStreamRuntime;
  close(): void;
}

export type MoonshineRuntimeFactory = (
  handlers: RuntimeHandlers,
) => Promise<TranscriberRuntime>;

export interface MoonshineStreamSession {
  acceptAudio(chunk: Float32Array): void;
  stop(): Promise<void>;
  readonly stopped: boolean;
}

export function getBrowserSupportError(
  capabilities: BrowserCapabilities = readBrowserCapabilities(),
): SpeechServiceError | null {
  if (
    !capabilities.hasWebAssembly ||
    !capabilities.hasAudioContext ||
    !capabilities.hasMediaDevices
  ) {
    return new SpeechServiceError(
      "unsupported-browser",
      "Your browser does not support the required audio/WebAssembly features. Please use a recent version of Chrome or Edge.",
    );
  }
  if (!capabilities.isCrossOriginIsolated) {
    return new SpeechServiceError(
      "cross-origin-isolation",
      "Moonshine's threaded WebAssembly runtime requires cross-origin isolation. Serve this page with COOP and COEP headers, using a recent version of Chrome or Edge.",
    );
  }
  return null;
}

function readBrowserCapabilities(): BrowserCapabilities {
  return {
    hasWebAssembly: typeof WebAssembly !== "undefined",
    hasAudioContext:
      typeof window !== "undefined" &&
      ("AudioContext" in window || "webkitAudioContext" in window),
    hasMediaDevices:
      typeof navigator !== "undefined" &&
      navigator.mediaDevices !== undefined &&
      typeof navigator.mediaDevices.getUserMedia === "function",
    isCrossOriginIsolated: globalThis.crossOriginIsolated === true,
  };
}

const MODEL_BASE = "/models/tiny-streaming-en";
const MODEL_FILES = [
  "frontend.ort",
  "encoder.ort",
  "adapter.ort",
  "cross_kv.ort",
  "decoder_kv.ort",
  "streaming_config.json",
  "tokenizer.bin",
] as const;

const LOCAL_MODEL_URLS = Object.fromEntries(
  MODEL_FILES.map((name) => [name, `${MODEL_BASE}/${name}`]),
);

async function createMoonshineRuntime(
  handlers: RuntimeHandlers,
): Promise<TranscriberRuntime> {
  const transcriber = await Transcriber.loadFromUrls(LOCAL_MODEL_URLS, {
    modelArch: ModelArch.TinyStreaming,
    onProgress: (loaded, total, file) =>
      handlers.onProgress(total ? loaded / total : 0, file, { loaded, total }),
  });

  return {
    createStream: () => {
      const stream = transcriber.createStream();
      stream.addListener({
        onLineTextChanged: ({ line }) => {
          if (line.text.trim()) handlers.onText(line.text.trim());
        },
        onLineCompleted: ({ line }) => {
          handlers.onLine(line);
        },
        onError: ({ error }) => handlers.onError(error),
      });
      return stream;
    },
    close: () => transcriber.close(),
  };
}

export function mapSpeechError(
  error: unknown,
  fallbackCode: SpeechServiceErrorCode = "recognition-failed",
): SpeechServiceError {
  if (error instanceof SpeechServiceError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new SpeechServiceError(
      "permission-denied",
      "Microphone permission denied. Please allow microphone access and try again.",
      { cause: error },
    );
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new SpeechServiceError(
      "microphone-unavailable",
      "No microphone device was detected.",
      { cause: error },
    );
  }
  return new SpeechServiceError(
    fallbackCode,
    fallbackCode === "model-load-failed"
      ? "Unable to initialize Moonshine."
      : "Speech recognition failed. Please try again.",
    { cause: error },
  );
}

class ActiveMoonshineStreamSession implements MoonshineStreamSession {
  private stopPromise: Promise<void> | null = null;
  private stoppedValue = false;
  private finalDelivered = false;

  constructor(
    private readonly stream: MoonshineStreamRuntime,
    private readonly callbacks: SpeechRecognitionCallbacks,
    private readonly onStopped: () => void,
  ) {}

  get stopped(): boolean {
    return this.stoppedValue;
  }

  acceptAudio(chunk: Float32Array): void {
    if (this.stoppedValue) return;
    try {
      this.stream.addAudio(chunk, 16_000);
      this.stream.transcribe();
    } catch (error) {
      this.callbacks.onError?.(mapSpeechError(error));
    }
  }

  deliverPartial(text: string): void {
    if (this.stoppedValue) return;
    this.callbacks.onPartialTranscript?.(text);
  }

  deliverFinal(result: FinalTranscriptResult): void {
    if (this.stoppedValue || this.finalDelivered) return;
    this.finalDelivered = true;
    this.callbacks.onFinalTranscript?.(result);
    void this.stop();
  }

  deliverError(error: Error): void {
    this.callbacks.onError?.(mapSpeechError(error));
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.stoppedValue) return;

    this.stopPromise = Promise.resolve()
      .then(() => {
        try {
          this.stream.transcribe(TranscribeFlags.ForceUpdate);
        } catch (error) {
          this.callbacks.onError?.(mapSpeechError(error));
        }
        this.stream.stop();
      })
      .finally(() => {
        this.stoppedValue = true;
        this.stream.removeAllListeners();
        this.stream.close();
        this.callbacks.onListeningStateChange?.(false);
        this.onStopped();
      });

    return this.stopPromise;
  }
}

export class MoonshineService {
  private runtime: TranscriberRuntime | null = null;
  private initializingPromise: Promise<void> | null = null;
  private activeSession: ActiveMoonshineStreamSession | null = null;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveDispose: (() => void) | null = null;
  private progressCallback?: RuntimeHandlers["onProgress"];

  constructor(
    private readonly runtimeFactory: MoonshineRuntimeFactory =
      createMoonshineRuntime,
    private readonly supportCheck: () => SpeechServiceError | null =
      getBrowserSupportError,
  ) {}

  onModelProgress(callback: RuntimeHandlers["onProgress"]): void {
    this.progressCallback = callback;
  }

  async initialize(): Promise<void> {
    this.cancelDeferredDispose();
    if (this.runtime) return;
    if (this.initializingPromise) return this.initializingPromise;

    const supportError = this.supportCheck();
    if (supportError) throw supportError;

    this.initializingPromise = this.runtimeFactory({
      onText: (text) => {
        if (import.meta.env.DEV) console.debug(`[Moonshine] partial: ${text}`);
        this.activeSession?.deliverPartial(text);
      },
      onLine: (line) => {
        if (!line.text.trim()) return;
        if (import.meta.env.DEV) console.debug(`[Moonshine] final: ${line.text}`);
        this.activeSession?.deliverFinal({
          text: line.text.trim(),
          sttCompletionTimeMs: line.lastTranscriptionLatencyMs,
          lineId: line.id,
        });
      },
      onError: (error) => this.activeSession?.deliverError(error),
      onProgress: (fraction, file, bytes) =>
        this.progressCallback?.(fraction, file, bytes),
    })
      .then((runtime) => {
        this.runtime = runtime;
        if (import.meta.env.DEV) console.info("[Moonshine] model loaded");
      })
      .catch((error) => {
        throw mapSpeechError(error, "model-load-failed");
      })
      .finally(() => {
        this.initializingPromise = null;
      });

    return this.initializingPromise;
  }

  async beginStream(
    callbacks: SpeechRecognitionCallbacks,
  ): Promise<MoonshineStreamSession> {
    this.cancelDeferredDispose();
    if (this.activeSession && !this.activeSession.stopped) {
      return this.activeSession;
    }

    await this.initialize();
    if (!this.runtime) throw new Error("Moonshine runtime is unavailable");

    const stream = this.runtime.createStream();
    const session = new ActiveMoonshineStreamSession(stream, callbacks, () => {
      if (this.activeSession === session) this.activeSession = null;
    });
    this.activeSession = session;
    stream.start();
    callbacks.onListeningStateChange?.(true);
    if (import.meta.env.DEV) console.info("[Moonshine] stream started");
    return session;
  }

  async startListening(
    callbacks: SpeechRecognitionCallbacks,
  ): Promise<void> {
    await this.beginStream(callbacks);
  }

  async stopListening(): Promise<void> {
    await this.activeSession?.stop();
  }

  async dispose(): Promise<void> {
    if (this.disposeTimer) {
      return new Promise((resolve) => {
        const previousResolve = this.resolveDispose;
        this.resolveDispose = () => {
          previousResolve?.();
          resolve();
        };
      });
    }

    return new Promise((resolve) => {
      this.resolveDispose = resolve;
      this.disposeTimer = setTimeout(() => {
        void this.closeNow();
      }, 0);
    });
  }

  private cancelDeferredDispose(): void {
    if (!this.disposeTimer) return;
    clearTimeout(this.disposeTimer);
    this.disposeTimer = null;
    this.resolveDispose?.();
    this.resolveDispose = null;
  }

  private async closeNow(): Promise<void> {
    this.disposeTimer = null;
    const pendingInitialization = this.initializingPromise;
    if (pendingInitialization) {
      await pendingInitialization.catch(() => undefined);
    }
    try {
      await this.stopListening();
    } finally {
      this.runtime?.close();
      this.runtime = null;
      this.resolveDispose?.();
      this.resolveDispose = null;
    }
  }
}

export const moonshineService = new MoonshineService();
