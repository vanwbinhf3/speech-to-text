type WorkerInboundMessage =
  | { type: "init" }
  | {
      type: "transcribe";
      requestId: string;
      pcm: Float32Array;
      sampleRate: number;
    };

type WorkerOutboundMessage =
  | { type: "ready"; loadTimeMs: number; modelSizeBytes: number }
  | {
      type: "progress";
      fraction: number;
      file: string;
      loaded?: number;
      total?: number;
    }
  | {
      type: "result";
      requestId: string;
      text: string;
      inferenceStartedAt: number;
      transcriptReadyAt: number;
    }
  | { type: "error"; requestId?: string; message: string };

interface WhisperWorkerScope {
  Module?: WhisperRuntimeModule;
  location: Location;
  postMessage: (message: WorkerOutboundMessage) => void;
  onmessage: ((event: MessageEvent<WorkerInboundMessage>) => void) | null;
}

declare function importScripts(...urls: string[]): void;

interface WhisperRuntimeModule {
  FS_createDataFile: (
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
  ) => void;
  FS_unlink: (path: string) => void;
  init: (modelPath: string) => number;
  full_default: (
    instance: number,
    audio: Float32Array,
    language: string,
    threads: number,
    translate: boolean,
  ) => number;
  print?: (line: string) => void;
  printErr?: (line: string) => void;
  setStatus?: (line: string) => void;
  mainScriptUrlOrBlob?: string;
  monitorRunDependencies?: (left: number) => void;
}

const ASSET_BASE = "/models/whisper-base-en-q5_1";
const RUNTIME_URL = `${ASSET_BASE}/main.js`;
const MODEL_URL = `${ASSET_BASE}/ggml-base.en-q5_1.bin`;
const MODEL_FILE = "ggml-base.en-q5_1.bin";
const MODEL_SIZE_BYTES = 59_721_011;
const MODEL_PATH = "whisper.bin";
const DEFAULT_TIMEOUT_MS = 90_000;
const workerScope = globalThis as unknown as WhisperWorkerScope;

let loadPromise: Promise<void> | null = null;
let instance = 0;
let loadTimeMs = 0;
let currentRequest:
  | {
      requestId: string;
      lines: string[];
      inferenceStartedAt: number;
      timeoutId: ReturnType<typeof setTimeout>;
      quietFinishId: ReturnType<typeof setTimeout> | null;
    }
  | null = null;

workerScope.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    void initialize();
    return;
  }
  if (message.type === "transcribe") {
    void transcribe(message.requestId, message.pcm);
  }
};

async function initialize(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const startedAt = performance.now();
    installRuntimeModuleHooks();
    importScripts(RUNTIME_URL);
    await waitForRuntime();
    const modelBytes = await fetchModel();
    storeModel(modelBytes);
    instance = workerScope.Module?.init(MODEL_PATH) ?? 0;
    if (!instance) throw new Error("Failed to initialize whisper.cpp model.");
    loadTimeMs = performance.now() - startedAt;
    post({ type: "ready", loadTimeMs, modelSizeBytes: MODEL_SIZE_BYTES });
  })().catch((error) => {
    post({ type: "error", message: errorMessage(error) });
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}

async function fetchModel(): Promise<Uint8Array> {
  const response = await fetch(MODEL_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch ${MODEL_FILE}: ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length")) || MODEL_SIZE_BYTES;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    post({
      type: "progress",
      fraction: contentLength ? loaded / contentLength : 0,
      file: MODEL_FILE,
      loaded,
      total: contentLength,
    });
  }

  const output = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function storeModel(modelBytes: Uint8Array): void {
  const module = workerScope.Module;
  if (!module) throw new Error("Whisper runtime module is unavailable.");
  try {
    module.FS_unlink(MODEL_PATH);
  } catch {
    // The first initialization has no previous in-memory model.
  }
  module.FS_createDataFile("/", MODEL_PATH, modelBytes, true, true);
}

async function transcribe(requestId: string, pcm: Float32Array): Promise<void> {
  try {
    await initialize();
    if (!instance || !workerScope.Module) throw new Error("Whisper is not ready.");

    if (currentRequest) {
      clearTimeout(currentRequest.timeoutId);
      post({
        type: "error",
        requestId: currentRequest.requestId,
        message: "Stale Whisper request superseded.",
      });
    }

    const inferenceStartedAt = performance.now();
    currentRequest = {
      requestId,
      lines: [],
      inferenceStartedAt,
      timeoutId: setTimeout(() => {
        if (currentRequest?.requestId === requestId) {
          currentRequest = null;
          post({ type: "error", requestId, message: "Whisper inference timed out." });
        }
      }, DEFAULT_TIMEOUT_MS),
      quietFinishId: null,
    };

    const ret = workerScope.Module.full_default(
      instance,
      pcm,
      "en",
      workerThreadCount(),
      false,
    );
    if (ret !== 0) throw new Error(`whisper.cpp returned ${ret}`);
  } catch (error) {
    post({ type: "error", requestId, message: errorMessage(error) });
  }
}

function installRuntimeModuleHooks(): void {
  workerScope.Module = {
    mainScriptUrlOrBlob: new URL(RUNTIME_URL, workerScope.location.origin).href,
    print: handleRuntimeLine,
    printErr: handleRuntimeLine,
    setStatus: handleRuntimeLine,
    monitorRunDependencies: () => undefined,
  } as unknown as WhisperRuntimeModule;
}

function handleRuntimeLine(rawLine: string): void {
  const line = String(rawLine);
  const request = currentRequest;
  if (!request) return;

  const transcriptLine = parseTranscriptLine(line);
  if (transcriptLine) request.lines.push(transcriptLine);

  if (line.includes("total time")) {
    finishCurrentRequest();
    return;
  }

  if (transcriptLine || line.includes("whisper_print_timings:")) {
    scheduleQuietFinish(request);
  }
}

function finishCurrentRequest(): void {
  const request = currentRequest;
  if (!request) return;
  clearTimeout(request.timeoutId);
  if (request.quietFinishId) clearTimeout(request.quietFinishId);
  currentRequest = null;
  post({
    type: "result",
    requestId: request.requestId,
    text: request.lines.join(" ").replace(/\s+/g, " ").trim(),
    inferenceStartedAt: request.inferenceStartedAt,
    transcriptReadyAt: performance.now(),
  });
}

function scheduleQuietFinish(request: NonNullable<typeof currentRequest>): void {
  if (request.quietFinishId) clearTimeout(request.quietFinishId);
  request.quietFinishId = setTimeout(() => {
    if (currentRequest?.requestId === request.requestId) {
      finishCurrentRequest();
    }
  }, request.lines.length > 0 ? 1_500 : 4_000);
}

function parseTranscriptLine(line: string): string | null {
  const match = line.match(/^\s*\[[^\]]+\]\s*(.+?)\s*$/);
  if (!match) return null;
  return match[1].trim();
}

async function waitForRuntime(): Promise<void> {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    if (typeof workerScope.Module?.init === "function") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for whisper.cpp runtime.");
}

function workerThreadCount(): number {
  return Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
}

function post(message: WorkerOutboundMessage): void {
  workerScope.postMessage(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
