# Moonshine-First Voice Navigation Benchmark

A browser-only technical proof of concept for English speech-to-text plus local
voice navigation intent detection. Moonshine Tiny Streaming consumes the live
microphone stream first. After Moonshine returns its final transcript, the demo
sends the full captured audio buffer to Whisper.cpp tiny.en Q5_1 for a batch
comparison, avoiding two ASR models running at the same time.

No Web Speech API, backend, cloud STT API, OpenAI API, Google Speech API,
AssemblyAI, database, authentication, or LLM intent detection is used.

## Requirements

- Node.js 20+
- Recent Chrome or Edge desktop recommended
- Microphone
- Internet access during the first `npm install` to download model/runtime assets

## Install

```bash
npm install
```

`postinstall` downloads and verifies:

- Moonshine Tiny Streaming English assets in `public/models/tiny-streaming-en`
- whisper.cpp browser runtime `main.js`
- Whisper model `ggml-tiny.en-q5_1.bin` in `public/models/whisper-tiny-en-q5_1`

Valid files are reused on later installs. Generated model directories are
excluded from Git.

## Run

```bash
npm run dev
```

Open the Vite URL, allow microphone access, wait for Moonshine to be ready,
optionally select an expected page label, then speak a short English command
such as `open dashboard` or `show GitHub integration`.

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## How It Works

```text
Microphone
    |
Shared 16 kHz mono PCM capture
    |
Moonshine Tiny Streaming
    |
Moonshine final transcript
    |
Send full captured PCM buffer to Whisper.cpp tiny.en Q5_1
    |
Whisper transcript
    |
Local TypeScript intent matcher
    |
Navigation target and benchmark metrics
```

`AudioCaptureService` owns `getUserMedia()` and stores the same resampled PCM
chunks that it streams into Moonshine. Moonshine receives chunks immediately
through a streaming `Transcriber.createStream()` session. Whisper is lazy-loaded
only after Moonshine returns a final transcript, then receives the completed PCM
buffer and runs in a worker using the self-hosted official whisper.cpp runtime.

Both transcripts call the same deterministic `detectNavigationIntent()` matcher.
The matcher normalizes text, checks token-boundary aliases, applies a small
navigation-cue boost, and uses lightweight Levenshtein matching with confidence
and ambiguity thresholds.

## Metrics

- Model timer: `modelResultReadyAt - modelAudioReceivedAt`.
  - Moonshine starts this timer when the first live PCM chunk is handed to the
    Moonshine stream and stops it when Moonshine returns the final transcript.
  - Whisper starts this timer when the completed PCM buffer is handed to the
    Whisper service and stops it when Whisper returns its transcript.
- Moonshine STT completion: `line.lastTranscriptionLatencyMs`, shown as an
  engine-provided debug value where available.
- Whisper inference: worker-side `transcriptReadyAt - inferenceStartedAt`, kept
  as a debug value and not mixed with main-thread timestamps for the main timer.
- Intent matching: local matcher duration measured with `performance.now()`.
- Perceived latency: `Command Ready After Stop = max(0, intentDetectedAt - recordingStoppedAt)`.

Moonshine is streaming and may finish before manual/auto recording stop, so the
perceived-latency metric clamps early readiness to zero. These numbers are useful for
perceived voice-navigation latency, not a scientific ASR benchmark.

## Browser and Hosting Requirements

The WASM runtimes require browser features available in modern Chrome and Edge.
Vite is configured with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Production hosting must serve equivalent headers for `SharedArrayBuffer`,
WASM threads, and SIMD support.

## Privacy

Audio is processed locally in the browser. The demo does not intentionally send
microphone audio to an external speech-to-text API. The first install downloads
model/runtime files from official Moonshine and whisper.cpp sources; the running
app serves those assets from the application origin.

To verify, open DevTools Network after Moonshine is ready, start a command, and
confirm that speaking creates no microphone audio upload requests. On the first
completed command, Whisper model/runtime assets may load from the local app
origin before the batch comparison runs.
