import { useCallback, useEffect, useMemo, useState } from "react";

import { BenchmarkControls } from "./components/BenchmarkControls";
import { BenchmarkHistory } from "./components/BenchmarkHistory";
import { ModelComparison } from "./components/ModelComparison";
import { ModelStatusPanel } from "./components/ModelStatusPanel";
import { PageOptions } from "./components/PageOptions";
import { SessionSummary } from "./components/SessionSummary";
import {
  BenchmarkController,
  type BenchmarkSnapshot,
} from "./services/benchmarkController";

const benchmarkController = new BenchmarkController();

export default function App() {
  const [snapshot, setSnapshot] = useState<BenchmarkSnapshot>(() =>
    benchmarkController.getSnapshot(),
  );
  const [expectedPageId, setExpectedPageId] = useState<string | null>(null);

  useEffect(() => benchmarkController.subscribe(setSnapshot), []);

  const initializeModels = useCallback(async () => {
    await benchmarkController.initializeModels();
  }, []);

  useEffect(() => {
    void initializeModels();
  }, [initializeModels]);

  const running =
    snapshot.status === "recording" || snapshot.status === "transcribing";
  const canStart =
    snapshot.moonshineStatus === "ready" && snapshot.status !== "loading-models";

  const detectedPages = useMemo(
    () => ({
      moonshine: snapshot.currentRun?.moonshine?.intent.pageId ?? null,
      whisper: snapshot.currentRun?.whisper?.intent.pageId ?? null,
    }),
    [snapshot.currentRun],
  );

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-mark" aria-hidden="true">
          STT
        </div>
        <div>
          <p className="eyebrow">Technical proof of concept</p>
          <h1>Moonshine-First Voice Benchmark</h1>
          <p className="hero-copy">
            Speak a short English navigation command. Moonshine streams the live
            microphone first; after its final transcript, the full captured audio
            is sent to Whisper.cpp for a batch comparison.
          </p>
        </div>
        <div className="privacy-pill">
          <span aria-hidden="true">●</span> Browser-local inference
        </div>
      </header>

      {(snapshot.moonshineError || snapshot.whisperError) && (
        <section className="error-banner" role="alert">
          <div>
            <strong>Speech Recognition Error</strong>
            <p>{snapshot.moonshineError ?? snapshot.whisperError}</p>
          </div>
          <button type="button" onClick={() => void initializeModels()}>
            Retry
          </button>
        </section>
      )}

      <ModelStatusPanel
        moonshineStatus={snapshot.moonshineStatus}
        whisperStatus={snapshot.whisperStatus}
        moonshineError={snapshot.moonshineError}
        whisperError={snapshot.whisperError}
        whisperProgress={snapshot.whisperProgress}
        onRetry={() => void initializeModels()}
      />

      <PageOptions
        moonshinePageId={detectedPages.moonshine}
        whisperPageId={detectedPages.whisper}
      />

      <div className="main-grid">
        <BenchmarkControls
          status={snapshot.status}
          partialTranscript={snapshot.currentRun?.partialTranscript ?? ""}
          inputVolume={snapshot.inputVolume}
          expectedPageId={expectedPageId}
          canStart={canStart}
          running={running}
          onExpectedPageChange={setExpectedPageId}
          onStart={() => void benchmarkController.start(expectedPageId)}
          onStop={() => void benchmarkController.stop()}
          onReset={() => void benchmarkController.reset()}
        />
        <SessionSummary summary={snapshot.summary} />
      </div>

      <ModelComparison
        moonshine={snapshot.currentRun?.moonshine ?? null}
        whisper={snapshot.currentRun?.whisper ?? null}
      />

      <BenchmarkHistory history={snapshot.history} />

      <footer>
        Moonshine Tiny Streaming v2 · Whisper.cpp tiny.en Q5_1 · Sequential local benchmark
      </footer>
    </main>
  );
}
