# Three-model TTS Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible measurements for Moonshine Small, Moonshine Medium, and Whisper Base.en across one 30-command TTS corpus and append the results to the existing Word comparison.

**Architecture:** A corpus manifest is the source of truth. A browser-only benchmark runner decodes each WAV once, streams identical 16 kHz PCM to one Moonshine model at a time, runs Whisper in batch, and exports raw JSON. A separate report updater validates and aggregates that JSON before extending the DOCX.

**Tech Stack:** React/Vite/TypeScript, `@moonshine-ai/moonshine-wasm@0.1.1`, whisper.cpp worker, Windows SAPI TTS, Vitest, Python `python-docx`.

## Global Constraints

- Use exactly 30 English commands and the same audio files for all models.
- Do not load Moonshine Small, Moonshine Medium, and Whisper simultaneously.
- Do not upload audio or call a cloud STT API.
- Latency is first model input to final transcript ready.
- Preserve the existing DOCX content and styling.

---

### Task 1: Corpus and metric primitives

**Files:**
- Create: `benchmark/corpus.json`
- Create: `src/services/corpusBenchmark.ts`
- Test: `src/services/corpusBenchmark.test.ts`

**Interfaces:**
- Produces: `normalizeBenchmarkText(text)`, `wordErrorRate(reference, hypothesis)`, `summarizeCorpusResults(rows)`.

- [ ] Write failing Vitest cases for punctuation normalization, edit-distance WER, percentile calculation, intent accuracy, Unknown false positives, and failure counts.
- [ ] Run `npm test -- src/services/corpusBenchmark.test.ts` and confirm failure because the module does not exist.
- [ ] Add the 30-row manifest and the minimal metric implementation.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Deterministic audio generation

**Files:**
- Create: `scripts/generate-tts-corpus.ps1`
- Create: `public/benchmark-audio/*.wav`

**Interfaces:**
- Consumes: `benchmark/corpus.json`.
- Produces: one WAV per corpus ID plus voice/rate metadata.

- [ ] Validate that every corpus ID and expected page is unique/valid.
- [ ] Generate all recordings through one installed English SAPI voice at a fixed rate and volume.
- [ ] Verify there are exactly 30 readable non-empty WAV files.

### Task 3: Browser benchmark runner

**Files:**
- Create: `src/services/threeModelBenchmarkRunner.ts`
- Test: `src/services/threeModelBenchmarkRunner.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `runThreeModelCorpusBenchmark(manifest, onProgress): Promise<CorpusBenchmarkExport>`.

- [ ] Write failing tests proving PCM chunk order, explicit Moonshine flush, sequential model disposal, Whisper batch input, timer boundaries, and 90 output rows.
- [ ] Run the focused test and confirm the expected failures.
- [ ] Implement the runner with injectable model adapters and a dev-only query-string entry point.
- [ ] Re-run focused tests and the complete `npm test` suite.

### Task 4: Execute and validate measurements

**Files:**
- Create: `benchmark/results/three-model-tts-results.json`

**Interfaces:**
- Consumes: browser runner export.
- Produces: 90 raw observations and three computed summaries.

- [ ] Start Vite and open the benchmark entry point in a cross-origin-isolated Chrome/Edge context.
- [ ] Run Small, dispose it, run Medium, dispose it, then run Whisper Base.
- [ ] Save the exported JSON without altering transcripts or timings.
- [ ] Validate 30 observations per model, no duplicate model-command keys, and aggregate recomputation from raw rows.

### Task 5: Update and verify the Word report

**Files:**
- Modify: `docs/so-sanh-moonshine-v2-va-whisper.docx`

**Interfaces:**
- Consumes: `benchmark/corpus.json` and `benchmark/results/three-model-tts-results.json`.
- Produces: updated comparison brief with measured findings.

- [ ] Append benchmark methodology, summary, detailed 30-command results, recommendation, and TTS limitations using the existing design tokens.
- [ ] Validate DOCX ZIP integrity, table dimensions, borders, non-empty cells, and hyperlinks.
- [ ] Run the document renderer; if LibreOffice remains unavailable, record that visual QA was skipped and rely on structural validation as permitted by the Documents skill.
- [ ] Run `npm test` and `npm run build`, then report only the observed results.
