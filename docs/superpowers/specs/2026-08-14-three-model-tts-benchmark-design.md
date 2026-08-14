# Three-model TTS benchmark design

## Goal

Measure Moonshine Small Streaming, Moonshine Medium Streaming, and Whisper Base.en Q5_1 against the same deterministic set of 30 English voice-navigation recordings, then add the measured results to the existing comparison DOCX.

## Corpus

- Generate 30 WAV files with one fixed Windows English TTS voice and rate.
- Normalize every file to mono 16 kHz float PCM before inference.
- Cover all eight navigation pages, common paraphrases, collision-prone phrases, and four Unknown commands.
- Store an explicit expected transcript and expected page for every item.
- Feed the exact same decoded PCM samples to all three engines.

## Execution

- Run models sequentially so only one large WASM model is resident at a time.
- Moonshine receives 100 ms PCM chunks followed by an explicit stream stop/flush.
- Whisper receives the complete PCM array as one batch, matching its current worker API.
- Start each latency timer immediately before the first model input and stop it when the final transcript is available.
- Persist raw per-command observations before computing summaries.

## Metrics

- Word error rate (WER), using normalized whitespace/punctuation-insensitive tokens.
- Transcript exact-match rate after the same normalization.
- Navigation intent accuracy using the existing local intent matcher.
- Unknown false-positive rate.
- Median and p95 end-to-result latency.
- Failure count for exceptions, timeouts, and empty transcripts.

## Report update

Extend `docs/so-sanh-moonshine-v2-va-whisper.docx` without replacing its existing analysis. Add methodology, corpus composition, a three-model summary table, a 30-command detailed-results table, measured recommendation, and a limitation note that clean synthetic TTS does not represent microphone noise, accent, reverberation, or spontaneous speech.

## Acceptance criteria

- All 30 files are generated once and reused unchanged by all models.
- A machine-readable results file contains 90 model-command observations.
- Every reported aggregate is derived from that results file.
- The DOCX remains structurally valid and its new tables have explicit borders and widths.
- The application test suite and production build still pass.
