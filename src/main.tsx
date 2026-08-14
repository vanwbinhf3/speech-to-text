import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const corpusBenchmarkMode =
  new URLSearchParams(window.location.search).get("corpusBenchmark") === "1";

if (corpusBenchmarkMode) {
  root.render(
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">REPRODUCIBLE LOCAL CORPUS RUN</p>
        <h1>Three-model TTS benchmark</h1>
        <p id="corpus-benchmark-status">Preparing the 30-command corpus...</p>
        <pre id="corpus-benchmark-result" hidden />
      </section>
    </main>,
  );

  void import("./services/threeModelBenchmarkRunner")
    .then(({ runBrowserCorpusBenchmark }) =>
      runBrowserCorpusBenchmark((progress) => {
        const status = document.getElementById("corpus-benchmark-status");
        if (status) {
          status.textContent = `${progress.message} (${progress.completed}/${progress.total})`;
        }
        benchmarkWindow.__corpusBenchmarkProgress = progress;
      }),
    )
    .then((result) => {
      benchmarkWindow.__corpusBenchmarkResult = result;
      const status = document.getElementById("corpus-benchmark-status");
      const output = document.getElementById("corpus-benchmark-result");
      if (output) output.textContent = JSON.stringify(result);
      if (status) status.textContent = "Benchmark complete. Results are ready for export.";
      console.info("[Corpus Benchmark] complete", result);
    })
    .catch((error) => {
      benchmarkWindow.__corpusBenchmarkError =
        error instanceof Error ? error.message : String(error);
      const status = document.getElementById("corpus-benchmark-status");
      if (status) status.textContent = `Benchmark failed: ${benchmarkWindow.__corpusBenchmarkError}`;
      console.error("[Corpus Benchmark] failed", error);
    });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

const benchmarkWindow = window as Window & {
  __corpusBenchmarkProgress?: unknown;
  __corpusBenchmarkResult?: unknown;
  __corpusBenchmarkError?: string;
};
