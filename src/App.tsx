import { useCallback, useEffect, useMemo, useState } from "react";

import { BenchmarkControls } from "./components/BenchmarkControls";
import { BenchmarkHistory } from "./components/BenchmarkHistory";
import { DiagnosticLogPanel } from "./components/DiagnosticLogPanel";
import { ModelComparison } from "./components/ModelComparison";
import { ModelStatusPanel } from "./components/ModelStatusPanel";
import { PageOptions } from "./components/PageOptions";
import { SessionSummary } from "./components/SessionSummary";
import {
  BenchmarkController,
  type BenchmarkSnapshot,
} from "./services/benchmarkController";
import { MOONSHINE_MODELS } from "./services/moonshineService";

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
  const detectedPageId = useMemo(
    () => snapshot.currentRun?.moonshine?.intent.pageId ?? null,
    [snapshot.currentRun],
  );

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-mark" aria-hidden="true">STT</div>
        <div>
          <p className="eyebrow">Technical proof of concept</p>
          <h1>Browser ASR Voice Navigation Benchmark</h1>
          <p className="hero-copy">
            Speak a short English navigation command. The browser streams local
            microphone audio into the selected Moonshine Tiny, Small, or Medium model,
            then sends the same buffered recording to Whisper Base.en for a
            sequential comparison without an LLM.
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
          {snapshot.moonshineError ? (
            <button type="button" onClick={() => void initializeModels()}>
              Retry
            </button>
          ) : (
            <span>Whisper will retry after the next Moonshine result.</span>
          )}
        </section>
      )}

      <ModelStatusPanel
        selectedModel={snapshot.selectedModel}
        moonshineStatus={snapshot.moonshineStatus}
        moonshineError={snapshot.moonshineError}
        moonshineProgress={snapshot.moonshineProgress}
        whisperStatus={snapshot.whisperStatus}
        whisperError={snapshot.whisperError}
        whisperProgress={snapshot.whisperProgress}
        selectionDisabled={running}
        onModelChange={(variant) => void benchmarkController.selectModel(variant)}
        onRetry={() => void initializeModels()}
      />

      <PageOptions moonshinePageId={detectedPageId} />

      <div className="main-grid">
        <BenchmarkControls
          status={snapshot.status}
          partialTranscript={snapshot.currentRun?.partialTranscript ?? ""}
          inputVolume={snapshot.inputVolume}
          inputPeakVolume={snapshot.inputPeakVolume}
          audioProcessingConfig={snapshot.audioProcessingConfig}
          expectedPageId={expectedPageId}
          canStart={canStart}
          running={running}
          onExpectedPageChange={setExpectedPageId}
          onAudioProcessingConfigChange={(patch) =>
            benchmarkController.updateAudioProcessingConfig(patch)
          }
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
      <DiagnosticLogPanel logs={snapshot.diagnosticLogs} />
      <BenchmarkHistory history={snapshot.history} />

      <footer>
        {MOONSHINE_MODELS[snapshot.selectedModel].name} → Whisper Base.en Q5_1 · Local inference
      </footer>
    </main>
  );
}
