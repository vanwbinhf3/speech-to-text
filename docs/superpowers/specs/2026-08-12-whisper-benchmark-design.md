# Moonshine and Whisper Voice Navigation Benchmark Design

## Purpose

Extend the existing React, Vite, and TypeScript demo into an in-browser
voice-navigation benchmark. One microphone recording must feed Moonshine Tiny
Streaming and Whisper.cpp `tiny.en` Q5_1 so their transcripts, navigation
intents, and perceived post-speech latency can be compared on the same device
and audio samples.

The implementation must preserve the existing page catalog and deterministic
`detectNavigationIntent()` matcher. It must not use Web Speech API, a cloud STT
API, a transcription backend, or mocked transcripts.

## Verified Runtime Basis

The installed Moonshine package exposes `Transcriber.createStream()` and
`Stream.addAudio()`, allowing the app to supply PCM rather than letting
`MicTranscriber` own microphone capture. This makes a single shared capture
pipeline possible without changing Moonshine's model or transcript semantics.

The official whisper.cpp browser example currently exposes a WebAssembly
browser runtime, requires WASM SIMD, and lists `ggml-tiny.en-q5_1.bin` as the
English Q5_1 model. The official example identifies its size as approximately
31 MB and runs inference through the Emscripten `init` and `full_default`
bindings.

References:

- https://github.com/ggml-org/whisper.cpp/tree/master/examples/whisper.wasm
- https://github.com/ggml-org/whisper.cpp/blob/master/examples/whisper.wasm/index-tmpl.html
- https://github.com/ggml-org/whisper.cpp/blob/master/examples/whisper.wasm/emscripten.cpp

## Architecture

### Shared audio pipeline

`AudioCaptureService` is the sole owner of `getUserMedia()`, the audio context,
and capture nodes. It downmixes capture to mono and resamples it to 16 kHz
`Float32Array` PCM. Each PCM chunk is sent to two consumers:

1. Moonshine receives chunks immediately through a streaming `Stream` and
   produces partial and committed transcripts.
2. The benchmark controller accumulates the same chunks into a command buffer.
   After recording stops, it transfers the completed buffer to the Whisper
   worker.

No second microphone stream is opened. This guarantees both engines operate on
the same captured samples and recording boundary.

### Moonshine adapter

The existing model initialization, local model URLs, browser checks, progress
reporting, StrictMode protection, and error mapping remain. Microphone ownership
is the only material refactor: `MoonshineStreamingService` creates a streaming
session from the already-loaded `Transcriber`, accepts PCM chunks, and emits the
same partial and final callback shapes used by the current UI.

The first non-empty committed Moonshine line requests automatic benchmark stop.
Stop is idempotent, and the user retains a manual Stop button. A 15-second
safety limit stops commands that never produce a committed line. Stopping the
Moonshine stream flushes its final pass before resources for that run are
released.

### Whisper worker

`WhisperService` owns one long-lived Web Worker and exposes model state,
initialization, transcription, retry, and disposal. The worker loads the
self-hosted official whisper.cpp Emscripten runtime once, places the model in
its in-memory filesystem, initializes one model context, and reuses it for all
benchmark runs.

Typed worker messages carry `requestId` and transferable PCM buffers. Heavy
Whisper inference stays outside the React main thread. Worker results include
the transcript and inference timestamps; errors are returned per request
without affecting Moonshine.

The model and runtime assets are downloaded during project installation from
official whisper.cpp-controlled sources, verified by exact size and checksum,
stored below `public/models/whisper-tiny-en-q5_1`, and excluded from Git. The
browser loads them from the application origin. Valid local files are not
downloaded again during later installs, renders, or benchmark runs.

## Run Lifecycle and Concurrency

Each run has a unique `runId`, `recordingStartedAt`, optional expected page, and
separate model result states. The lifecycle is:

```text
Models loading
  -> Ready
  -> Recording
  -> Auto-stop, manual stop, or 15-second limit
  -> Moonshine flush and Whisper transcription
  -> Complete or partial failure
```

Moonshine results render as soon as they are available. Whisper independently
moves from Recording to Transcribing to Ready. The UI does not wait for both
engines before displaying a completed result.

Reset stops capture, invalidates the current run generation, clears results and
history, and ignores late worker or streaming callbacks whose `runId` no longer
matches. It does not unload either model. Initialization uses cached promises
and singleton services, including deferred disposal protection for React
StrictMode.

Both models initialize concurrently with `Promise.allSettled()`. Model failures
are independent and have separate Retry controls. Standard two-model benchmark
mode is enabled only when both are ready. If Whisper fails, the user may still
run Moonshine-only mode so the existing functionality remains usable.

## Shared Intent Processing

Both transcripts call the existing exported `detectNavigationIntent()` without
model-specific aliases, thresholds, or post-processing. Intent matching is
timed independently with `performance.now()` for each transcript.

Each `ModelBenchmarkResult` contains:

- model identifier and transcript;
- the existing navigation intent result;
- transcript-ready and intent-ready timestamps;
- speech/inference and matcher timings;
- optional correctness against the expected page;
- optional model-specific error.

## Metrics

The metrics deliberately distinguish streaming and batch ASR semantics.

### Moonshine

- **Speech processing:** Moonshine's `lastTranscriptionLatencyMs` for the
  committed line.
- **Intent matching:** local matcher duration after that transcript is
  available.

### Whisper

- **Inference:** `transcriptReadyAt - inferenceStartedAt`.
- **Post-stop STT:** `transcriptReadyAt - recordingStoppedAt`.
- **Intent matching:** local matcher duration after the Whisper transcript is
  available.

### Comparable metrics

- **Command Ready After Stop:**
  `max(0, intentReadyAt - recordingStoppedAt)`. This is the primary comparison
  metric and never becomes negative when streaming Moonshine finishes early.
- **Start to Command Ready:**
  `intentReadyAt - recordingStartedAt`. This includes speaking duration and is
  shown only as a debug/session metric.
- **Accuracy:** a labeled run is correct when
  `detectedPageId === expectedPageId`. Unlabeled runs are excluded from accuracy
  denominators but remain included in latency aggregates.

Session statistics include mean and median Command Ready After Stop for each
model. Accuracy displays numerator, denominator, and percentage only when at
least one run has an expected page.

## UI Design

The application retains its clean desktop-first visual system and Available
Pages panel, but becomes a benchmark dashboard:

- `ModelStatusPanel` shows Moonshine and Whisper status, progress, verified
  asset size, model load time, error, and Retry.
- `BenchmarkControls` contains optional Expected Page, Start/Stop Benchmark,
  Reset, overall run status, Moonshine partial text, and Whisper
  recording/transcribing status.
- `ModelComparison` renders two independent cards with transcript, target,
  confidence, correctness, speech/inference latency, intent matching, Command
  Ready After Stop, and debug session duration.
- `SessionSummary` shows model accuracy, average latency, and median latency.
- `BenchmarkHistory` stores the newest 20 runs and compares both outputs in one
  row.
- Suggested English commands remain visible for demos.

If both models detect the same page, the existing Available Pages chip receives
a shared success highlight. If they disagree, the chip panel identifies each
model's target separately instead of selecting one arbitrarily. Responsive
layouts stack model cards and preserve a usable history table on narrow screens.

## Error Handling

Model initialization, microphone, streaming, and inference failures have typed
states and actionable messages. A Whisper failure never removes a Moonshine
result, and a Moonshine failure never discards a valid Whisper recording or
result. Permission denied and no-device errors retain the current wording.

The worker reports load and inference errors rather than throwing uncaught
events. Run-level errors are stored in the relevant model result. Initialization
Retry replaces only the failed runtime and cannot create duplicate model
instances.

## Testing and Verification

Implementation follows test-driven development. New automated tests cover:

- PCM fan-out uses one capture sequence for both consumers;
- start and stop idempotency, Moonshine committed-line auto-stop, and timeout;
- stale `runId` responses cannot update a new or reset run;
- Command Ready After Stop clamps early Moonshine readiness to zero;
- Whisper inference and matcher metric composition;
- mean, median, accuracy, unlabeled accuracy, and 20-run history cap;
- both model results pass through the same matcher function;
- independent model errors and retries;
- existing Moonshine lifecycle and all existing intent matcher cases.

Final automated verification runs `npm install`, `npm test`, any configured
lint script, and `npm run build`. Browser smoke testing verifies both local
models reach Ready, assets come from the application origin, workers do not
freeze the page, and desktop/mobile layouts render without overflow.

Microphone inference is reported as manually verified only if the environment
actually grants microphone access and a real command is transcribed by both
models. Otherwise the final report explicitly provides the Chrome/Edge manual
test checklist and marks browser microphone verification as required.

## Privacy and Limitations

Captured PCM and inference remain inside the browser. Installation may download
model/runtime assets from their official sources, but the running app does not
intentionally upload microphone audio or call a cloud transcription service.

Whisper is batch inference after recording, while Moonshine is streaming.
Command Ready After Stop is useful for perceived voice-navigation performance,
but this is not a scientific ASR or word-error-rate benchmark. Results depend
on command duration, CPU, browser, WASM SIMD/thread support, and device load.
