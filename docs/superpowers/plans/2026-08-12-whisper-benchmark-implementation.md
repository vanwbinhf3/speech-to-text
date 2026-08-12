# Whisper Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Moonshine voice-navigation demo into a dual-model in-browser benchmark comparing Moonshine Tiny Streaming with Whisper.cpp tiny.en Q5_1 on the same microphone recording.

**Architecture:** A single audio capture owner produces 16 kHz mono PCM chunks and fans them out to Moonshine streaming plus a Whisper batch buffer. Moonshine keeps a streaming session over the loaded `Transcriber`; Whisper runs inside a long-lived worker using self-hosted whisper.cpp assets. Both transcripts use the existing deterministic `detectNavigationIntent()` and shared metric helpers.

**Tech Stack:** React, Vite, TypeScript, Vitest, `@moonshine-ai/moonshine-wasm@0.1.1`, official whisper.cpp WebAssembly runtime, `ggml-tiny.en-q5_1.bin`.

## Global Constraints

- Do not use Web Speech API, OpenAI API, Google Speech API, AssemblyAI, a backend STT endpoint, mocked transcripts, or hard-coded speech text.
- Runtime audio and inference must stay in the browser; first install may download official model/runtime assets.
- Keep the existing Moonshine Tiny Streaming v2 model and local asset loading behavior.
- Use `performance.now()` for latency metrics.
- One user recording must feed both ASR engines.
- History keeps newest rows first and caps at 20 benchmark runs.
- Standard two-model benchmark requires both models ready; Moonshine-only fallback is allowed if Whisper fails.
- Run `npm install`, `npm test`, and `npm run build` before completion. Run lint only if a lint script exists.

---

### Task 1: Benchmark Data Model and Metrics

**Files:**
- Modify: `src/types/navigation.ts`
- Modify: `src/services/commandProcessor.ts`
- Create: `src/services/benchmarkMetrics.ts`
- Create: `src/services/benchmarkMetrics.test.ts`
- Modify: `src/services/commandProcessor.test.ts`

**Interfaces:**
- Produces: `ModelId = "moonshine" | "whisper"`.
- Produces: `createModelBenchmarkResult(input): ModelBenchmarkResult`.
- Produces: `addBenchmarkHistoryItem(history, run): BenchmarkHistoryRun[]` capped at 20.
- Produces: `summarizeBenchmarkHistory(history): BenchmarkSummary`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from "vitest";
import {
  addBenchmarkHistoryItem,
  createModelBenchmarkResult,
  summarizeBenchmarkHistory,
} from "./benchmarkMetrics";

test("clamps command ready after stop when streaming result is early", () => {
  const result = createModelBenchmarkResult({
    modelId: "moonshine",
    transcript: "open dashboard",
    lineId: "line-1",
    recordingStartedAt: 100,
    recordingStoppedAt: 1000,
    transcriptReadyAt: 900,
    intentDetectedAt: 910,
    sttCompletionTimeMs: 280,
    inferenceStartedAt: null,
    commandProcessingTimeMs: 10,
    expectedPageId: "dashboard",
  });
  expect(result.metrics.commandReadyAfterStopMs).toBe(0);
  expect(result.correct).toBe(true);
});

test("computes whisper inference and post-stop latency", () => {
  const result = createModelBenchmarkResult({
    modelId: "whisper",
    transcript: "open settings",
    lineId: "request-1",
    recordingStartedAt: 100,
    recordingStoppedAt: 700,
    transcriptReadyAt: 950,
    intentDetectedAt: 952,
    sttCompletionTimeMs: null,
    inferenceStartedAt: 720,
    commandProcessingTimeMs: 2,
    expectedPageId: "settings",
  });
  expect(result.metrics.inferenceTimeMs).toBe(230);
  expect(result.metrics.postStopSttTimeMs).toBe(250);
  expect(result.metrics.commandReadyAfterStopMs).toBe(252);
});

test("caps benchmark history at newest 20", () => {
  const history = Array.from({ length: 25 }, (_, index) => ({
    id: `run-${index}`,
    startedAt: index,
    stoppedAt: index + 1,
    expectedPageId: null,
    moonshine: null,
    whisper: null,
  })).reduce((items, item) => addBenchmarkHistoryItem(items, item), []);
  expect(history).toHaveLength(20);
  expect(history[0].id).toBe("run-24");
});

test("summarizes average median and labeled accuracy per model", () => {
  const history = [
    {
      id: "run-2",
      startedAt: 0,
      stoppedAt: 1,
      expectedPageId: "settings",
      moonshine: createModelBenchmarkResult({
        modelId: "moonshine",
        transcript: "open settings",
        lineId: "m2",
        recordingStartedAt: 0,
        recordingStoppedAt: 100,
        transcriptReadyAt: 250,
        intentDetectedAt: 300,
        sttCompletionTimeMs: 140,
        inferenceStartedAt: null,
        commandProcessingTimeMs: 50,
        expectedPageId: "settings",
      }),
      whisper: null,
    },
    {
      id: "run-1",
      startedAt: 0,
      stoppedAt: 1,
      expectedPageId: "dashboard",
      moonshine: createModelBenchmarkResult({
        modelId: "moonshine",
        transcript: "open tasks",
        lineId: "m1",
        recordingStartedAt: 0,
        recordingStoppedAt: 100,
        transcriptReadyAt: 160,
        intentDetectedAt: 200,
        sttCompletionTimeMs: 50,
        inferenceStartedAt: null,
        commandProcessingTimeMs: 40,
        expectedPageId: "dashboard",
      }),
      whisper: null,
    },
  ];
  const summary = summarizeBenchmarkHistory(history);
  expect(summary.moonshine.averageCommandReadyAfterStopMs).toBe(200);
  expect(summary.moonshine.medianCommandReadyAfterStopMs).toBe(200);
  expect(summary.moonshine.accuracy).toEqual({ correct: 1, total: 2, percentage: 50 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/benchmarkMetrics.test.ts`
Expected: FAIL because `benchmarkMetrics` does not exist.

- [ ] **Step 3: Implement minimal types and metric helpers**

Add benchmark types and helpers. `createModelBenchmarkResult()` calls `detectNavigationIntent()` exactly once per transcript, computes matcher-independent timing from supplied timestamps, and clamps `commandReadyAfterStopMs` with `Math.max(0, intentDetectedAt - recordingStoppedAt)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/benchmarkMetrics.test.ts`
Expected: PASS.

### Task 2: Shared Audio Capture

**Files:**
- Create: `src/services/audioCaptureService.ts`
- Create: `src/services/audioCaptureService.test.ts`
- Create: `src/services/pcmAudio.ts`
- Create: `src/services/pcmAudio.test.ts`

**Interfaces:**
- Produces: `AudioCaptureService.start(callbacks): Promise<AudioCaptureSession>`.
- Produces: `AudioCaptureSession.stop(): Promise<Float32Array>`.
- Produces: `resampleLinear(input, inputSampleRate, outputSampleRate): Float32Array`.
- Consumes: Browser `getUserMedia`, `AudioContext`, and `AudioWorklet`/`ScriptProcessor` APIs through injectable adapters for tests.

- [ ] **Step 1: Write failing tests**

```ts
test("resamples mono pcm to 16 khz with deterministic length", () => {
  const input = Float32Array.from([0, 0.5, 1, 0.5, 0]);
  const output = resampleLinear(input, 48000, 16000);
  expect(output.length).toBe(2);
  expect(output[0]).toBeCloseTo(0);
});

test("fan out passes identical chunk instance copies to every consumer", () => {
  const source = new AudioChunkFanout();
  const left: Float32Array[] = [];
  const right: Float32Array[] = [];
  source.addConsumer((chunk) => left.push(chunk));
  source.addConsumer((chunk) => right.push(chunk));
  source.push(Float32Array.from([0.1, 0.2]));
  expect(Array.from(left[0])).toEqual(Array.from(right[0]));
});

test("stopped session returns concatenated pcm and ignores duplicate stop", async () => {
  const session = new TestAudioCaptureSession();
  session.push(Float32Array.from([1, 2]));
  session.push(Float32Array.from([3]));
  await expect(session.stop()).resolves.toEqual(Float32Array.from([1, 2, 3]));
  await expect(session.stop()).resolves.toEqual(Float32Array.from([1, 2, 3]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/pcmAudio.test.ts src/services/audioCaptureService.test.ts`
Expected: FAIL because files/classes do not exist.

- [ ] **Step 3: Implement PCM utilities and capture session**

Implement `resampleLinear`, `concatFloat32Arrays`, `AudioChunkFanout`, `AudioCaptureService`, and test-only injectable capture hooks. Runtime capture uses one mic stream and pushes 16 kHz mono chunks to all registered consumers while accumulating the exact same chunks for Whisper.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/pcmAudio.test.ts src/services/audioCaptureService.test.ts`
Expected: PASS.

### Task 3: Moonshine Streaming Refactor

**Files:**
- Modify: `src/services/moonshineService.ts`
- Modify: `src/services/moonshineService.test.ts`

**Interfaces:**
- Consumes: `Float32Array` 16 kHz PCM chunks from `AudioCaptureService`.
- Produces: `MoonshineService.beginStream(callbacks): Promise<MoonshineStreamSession>`.
- Produces: `MoonshineStreamSession.acceptAudio(chunk): void`.
- Produces: `MoonshineStreamSession.stop(): Promise<void>`.

- [ ] **Step 1: Write failing tests**

Add tests proving:

```ts
test("streaming session sends external pcm chunks to Moonshine stream", async () => {
  const fakeStream = createFakeMoonshineStream();
  const service = createServiceWithFakeStream(fakeStream);
  const session = await service.beginStream(callbacks);
  session.acceptAudio(Float32Array.from([0.1, 0.2]));
  expect(fakeStream.addAudioCalls[0].sampleRate).toBe(16000);
});

test("first committed line auto-stops only once", async () => {
  const fakeStream = createFakeMoonshineStream();
  const service = createServiceWithFakeStream(fakeStream);
  const session = await service.beginStream(callbacks);
  fakeStream.emitLine({ id: "line-1", text: "open dashboard", lastTranscriptionLatencyMs: 42 });
  fakeStream.emitLine({ id: "line-2", text: "open settings", lastTranscriptionLatencyMs: 42 });
  expect(callbacks.onFinalTranscript).toHaveBeenCalledTimes(1);
  await session.stop();
  await session.stop();
  expect(fakeStream.stopCalls).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/moonshineService.test.ts`
Expected: FAIL because current service uses `MicTranscriber`.

- [ ] **Step 3: Implement streaming adapter**

Replace runtime mic ownership with `Transcriber.createStream()`. Preserve local model loading, model progress, browser support checks, error mapping, singleton initialization guard, and deferred StrictMode disposal.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/moonshineService.test.ts`
Expected: PASS.

### Task 4: Whisper Asset Download and Worker Service

**Files:**
- Modify: `scripts/download-model.mjs`
- Modify: `.gitignore`
- Create: `src/workers/whisperWorker.ts`
- Create: `src/services/whisperService.ts`
- Create: `src/services/whisperService.test.ts`

**Interfaces:**
- Produces: `WhisperService.initialize(callbacks): Promise<void>`.
- Produces: `WhisperService.transcribe(pcm, requestId): Promise<WhisperTranscriptResult>`.
- Produces: worker messages `init`, `progress`, `ready`, `transcribe`, `result`, `error`.

- [ ] **Step 1: Write failing tests**

```ts
test("initialize caches the worker init promise", async () => {
  const worker = new FakeWhisperWorker();
  const service = new WhisperService(() => worker);
  await Promise.all([service.initialize(), service.initialize()]);
  expect(worker.postedMessages.filter((message) => message.type === "init")).toHaveLength(1);
});

test("transcribe ignores stale worker request ids", async () => {
  const worker = new FakeWhisperWorker();
  const service = new WhisperService(() => worker);
  const first = service.transcribe(Float32Array.from([0.1]), "first");
  const second = service.transcribe(Float32Array.from([0.2]), "second");
  worker.resolveResult("first", "open dashboard");
  worker.resolveResult("second", "open settings");
  await expect(first).rejects.toThrow(/stale/i);
  await expect(second).resolves.toMatchObject({ text: "open settings" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/whisperService.test.ts`
Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement downloader and worker service**

Extend the existing idempotent downloader with Whisper runtime/model assets under `public/models/whisper-tiny-en-q5_1`. Implement the worker wrapper around official whisper.cpp runtime, FS model loading, `init`, `full_default`, typed progress/results/errors, and singleton `whisperService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/whisperService.test.ts`
Expected: PASS.

### Task 5: Benchmark Controller and UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/PageOptions.tsx`
- Replace: `src/components/VoiceControl.tsx`
- Replace: `src/components/ResultPanel.tsx`
- Replace: `src/components/CommandHistory.tsx`
- Create: `src/components/ModelStatusPanel.tsx`
- Create: `src/components/BenchmarkControls.tsx`
- Create: `src/components/ModelComparison.tsx`
- Create: `src/components/SessionSummary.tsx`
- Create: `src/components/BenchmarkHistory.tsx`
- Modify: `src/styles.css`
- Create: `src/App.test.tsx` or focused controller tests if React DOM test setup is unsuitable.

**Interfaces:**
- Consumes: `AudioCaptureService`, `MoonshineService.beginStream()`, `WhisperService`, and benchmark metric helpers.
- Produces: UI with independent model status/retry, optional expected page, start/stop/reset, partial transcript, side-by-side results, summary, and 20-run history.

- [ ] **Step 1: Write failing tests**

Add controller-level tests for:

```ts
test("reset invalidates stale run updates", async () => {
  const controller = createBenchmarkController(fakes);
  await controller.start();
  const staleRunId = controller.currentRunId;
  await controller.reset();
  fakes.whisper.resolve(staleRunId, "open dashboard");
  expect(controller.state.history).toHaveLength(0);
});

test("moonshine final auto-stops capture and starts whisper", async () => {
  const controller = createBenchmarkController(fakes);
  await controller.start();
  fakes.moonshine.emitFinal("open dashboard");
  expect(fakes.audio.stopCalls).toBe(1);
  expect(fakes.whisper.transcribeCalls).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/benchmarkController.test.ts`
Expected: FAIL because controller does not exist.

- [ ] **Step 3: Implement benchmark controller and React integration**

Create a testable controller hook/service for run state, stale run guards, auto-stop/manual-stop/timeout, model result updates, history, reset, and retries. Wire the React UI to the controller and replace single-result panels with benchmark panels.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/services/benchmarkController.test.ts`
Expected: PASS.

### Task 6: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `package.json` only if scripts or dependencies changed.

**Interfaces:**
- Consumes: final implementation behavior and actual verification output.
- Produces: README with architecture, privacy, model download caveat, headers, and manual smoke checklist.

- [ ] **Step 1: Update README**

Document `npm install`, `npm run dev`, `npm test`, `npm run build`, model downloads, local browser inference, privacy, metric definitions, Chrome/Edge requirements, and manual microphone verification.

- [ ] **Step 2: Run verification**

Run:

```bash
npm install
npm test
npm run build
```

If `npm run` lists a `lint` script, run `npm run lint` too.

- [ ] **Step 3: Start dev server**

Run `npm run dev -- --host 127.0.0.1` and report the local URL. Keep it running only if the command session remains needed for the user to try the app.

- [ ] **Step 4: Final report**

Report:

```text
Implementation Summary

- Moonshine integration:
- Whisper integration:
- Model used:
- Browser runtime:
- Intent matching approach:
- Response-time definition:
- Model loading/caching:

Files Added/Changed

Verification

How to run

npm install
npm run dev
```

Mention whether real microphone browser smoke testing was completed or still requires user-side Chrome/Edge verification.

## Self-Review

- Spec coverage: The plan covers shared capture, Moonshine stream refactor, Whisper worker/assets, shared matcher, metrics, UI, history, reset/stale guards, README, and verification.
- Placeholder scan: No `TBD`, `TODO`, or unspecified “handle edge cases” steps remain.
- Type consistency: Types used by controller and UI are produced by Task 1, audio services by Task 2, Moonshine by Task 3, and Whisper by Task 4.
