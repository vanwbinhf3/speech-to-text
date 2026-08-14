import { MOONSHINE_MODELS } from "../services/moonshineService";
import type { ModelBenchmarkResult } from "../types/navigation";

interface ModelComparisonProps {
  moonshine: ModelBenchmarkResult | null;
}

export function ModelComparison({ moonshine }: ModelComparisonProps) {
  const target = moonshine?.intent.pageName ?? (moonshine ? "Unknown" : "-");
  const title = moonshine?.modelVariant
    ? MOONSHINE_MODELS[moonshine.modelVariant].name
    : "Moonshine Streaming";

  return (
    <section className="comparison-grid comparison-grid--single" aria-label="Moonshine result">
      <article className="panel model-result-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Transcript result</p>
            <h2>{title}</h2>
          </div>
          {moonshine?.correct !== null && moonshine?.correct !== undefined && (
            <span className={moonshine.correct ? "result-state" : "result-state result-state--unknown"}>
              {moonshine.correct ? "Correct" : "Mismatch"}
            </span>
          )}
        </div>
        <div className="result-block result-block--wide">
          <span>Recognized text</span>
          <strong>{moonshine ? `"${moonshine.transcript}"` : "-"}</strong>
        </div>
        <div className="result-grid result-grid--compact">
          <Metric label="Detected page" value={target} accent />
          <Metric
            label="Model timer"
            value={moonshine ? `${Math.round(moonshine.metrics.modelProcessingTimeMs)} ms` : "-"}
          />
          <Metric
            label="Moonshine transcription latency"
            value={moonshine?.metrics.sttCompletionTimeMs === null || !moonshine
              ? "-"
              : `${Math.round(moonshine.metrics.sttCompletionTimeMs)} ms`}
          />
          <Metric
            label="Intent matching"
            value={moonshine ? `${moonshine.metrics.commandProcessingTimeMs.toFixed(2)} ms` : "-"}
          />
          <Metric
            label="Confidence"
            value={moonshine ? `${Math.round(moonshine.intent.confidence * 100)}%` : "-"}
          />
          <Metric label="Matched phrase" value={moonshine?.intent.matchedPhrase ?? "-"} />
        </div>
      </article>
    </section>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="result-block metric-block">
      <span>{label}</span>
      <strong className={accent ? "target" : undefined}>{value}</strong>
    </div>
  );
}
