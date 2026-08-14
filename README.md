# Moonshine v2 Tiny/Small/Medium Voice Navigation Benchmark

A browser-only technical proof of concept for comparing Moonshine v2 Tiny,
Small, and Medium Streaming on short English voice-navigation commands.
Speech-to-text, intent detection, audio preprocessing, and latency measurement
all run locally in the browser.

The benchmark does not use Web Speech API, a backend, a cloud STT API, an LLM,
or upload microphone audio. The previous Whisper implementation remains in the
repository for future experiments but is not initialized by this benchmark.

## Requirements

- Node.js 20+
- Recent Chrome or Edge desktop
- Microphone
- Internet access the first time each Moonshine model is selected

## Install and run

```bash
npm install
npm run dev
```

Open the Vite URL, allow microphone access, wait for Small Streaming to become
ready, optionally label the expected page, and speak a short command such as
`open dashboard` or `show GitHub integration`.

## Build and test

```bash
npm test
npm run build
```

## Models

The selector offers the official English Moonshine v2 streaming architectures:

- Tiny Streaming: 34M parameters, lowest memory footprint.
- Small Streaming: 123M parameters, selected by default.
- Medium Streaming: 245M parameters, more accurate but slower and more
  memory-intensive.

The application uses `@moonshine-ai/moonshine-wasm@0.1.1` and maps the choices
to `ModelArch.TinyStreaming`, `ModelArch.SmallStreaming`, and
`ModelArch.MediumStreaming`. Only one
transcriber is held in WASM memory. Changing the selection stops any stream,
closes the old transcriber, then loads the new architecture.

Model files are downloaded from the official Moonshine CDN when first selected
and stored in the browser Cache API. They are not downloaded during
`npm install`. Clearing site data removes this model cache.

## How it works

```text
Microphone
    ↓
16 kHz mono PCM + local audio preprocessing
    ↓
Selected Moonshine v2 streaming model
    ↓
Partial and final transcript
    ↓
Local TypeScript intent matcher
    ↓
Navigation target and per-model benchmark metrics
```

`AudioCaptureService` owns `getUserMedia()`, downmixes and resamples microphone
audio, then sends every processed PCM chunk to the active Moonshine stream.
The same chunks also drive the RMS/Peak meter and lightweight silence detector.

Recording stops when the user clicks Stop, when speech is followed by roughly
one second of silence, or when the 15-second safety timeout fires. Stopping
forces Moonshine to flush the final transcript.

## Audio quality controls

- Input gain applies 1x–4x gain after resampling; default is 2x.
- Enhanced microphone enables browser echo cancellation, noise suppression,
  and automatic gain control.
- Raw microphone disables browser preprocessing for comparison.
- Optional noise gate suppresses low-level samples before gain.
- RMS and Peak meters help diagnose quiet or muted microphone input.

## Metrics

- Model timer: `modelResultReadyAt - modelAudioReceivedAt`. It begins when the
  first PCM chunk reaches the selected Moonshine model and ends when its final
  transcript is available.
- Moonshine transcription latency: `TranscriptLine.lastTranscriptionLatencyMs`,
  displayed separately as a library-reported diagnostic.
- Intent matching: local matcher duration measured with `performance.now()`.
- Session summaries report average/median model timers and labeled accuracy
  separately for Tiny, Small, and Medium.

These metrics are useful for comparing perceived voice-navigation behavior on
the current device; they are not a scientific ASR benchmark.

## Browser and hosting requirements

The threaded WASM build requires cross-origin isolation. Vite dev and preview
must serve:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Production hosting must serve equivalent headers for `SharedArrayBuffer`, WASM
threads, and SIMD.

## Privacy

Microphone audio is processed locally in the browser and is not intentionally
sent to an external speech-to-text service. The selected model assets are fetched
from the Moonshine CDN on first use. To verify this, open DevTools Network after
the model is ready and confirm that speaking creates no audio upload requests.
