import { MOONSHINE_MODELS } from "../services/moonshineService";
import type { ModelBenchmarkResult } from "../types/navigation";

interface ModelComparisonProps {
  moonshine: ModelBenchmarkResult | null;
  whisper: ModelBenchmarkResult | null;
}

export function ModelComparison({ moonshine, whisper }: ModelComparisonProps) {
  const moonshineTitle = moonshine?.modelVariant
    ? MOONSHINE_MODELS[moonshine.modelVariant].name
    : "Moonshine Streaming";

  return (
    <section className="comparison-grid" aria-label="Model comparison">
      <ResultCard
        title={moonshineTitle}
        result={moonshine}
        diagnosticLabel="Moonshine transcription latency"
        diagnosticValue={moonshine?.metrics.sttCompletionTimeMs ?? null}
      />
      <ResultCard
        title="Whisper Base.en Q5_1"
        result={whisper}
        diagnosticLabel="Whisper inference"
        diagnosticValue={whisper?.metrics.inferenceTimeMs ?? null}
      />
    </section>
  );
}

function ResultCard({
  title,
  result,
  diagnosticLabel,
  diagnosticValue,
}: {
  title: string;
  result: ModelBenchmarkResult | null;
  diagnosticLabel: string;
  diagnosticValue: number | null;
}) {
  const target = result?.intent.pageName ?? (result ? "Unknown" : "-");
  return (
      <article className="panel model-result-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Transcript result</p>
            <h2>{title}</h2>
          </div>
          {result?.correct !== null && result?.correct !== undefined && (
            <span className={result.correct ? "result-state" : "result-state result-state--unknown"}>
              {result.correct ? "Correct" : "Mismatch"}
            </span>
          )}
        </div>
        <div className="result-block result-block--wide">
          <span>Recognized text</span>
          <strong>{result ? `"${result.transcript}"` : "-"}</strong>
        </div>
        <div className="result-grid result-grid--compact">
          <Metric label="Detected page" value={target} accent />
          <Metric
            label="Model timer"
            value={result ? `${Math.round(result.metrics.modelProcessingTimeMs)} ms` : "-"}
          />
          <Metric
            label={diagnosticLabel}
            value={diagnosticValue === null ? "-" : `${Math.round(diagnosticValue)} ms`}
          />
          <Metric
            label="Intent matching"
            value={result ? `${result.metrics.commandProcessingTimeMs.toFixed(2)} ms` : "-"}
          />
          <Metric
            label="Confidence"
            value={result ? `${Math.round(result.intent.confidence * 100)}%` : "-"}
          />
          <Metric label="Matched phrase" value={result?.intent.matchedPhrase ?? "-"} />
        </div>
      </article>
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
