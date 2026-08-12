import type { CommandHistoryItem } from "../types/navigation";

interface ResultPanelProps {
  result: CommandHistoryItem | null;
}

export function ResultPanel({ result }: ResultPanelProps) {
  const target = result?.intent.pageName ?? (result ? "Unknown" : "—");

  return (
    <section className="panel result-panel" aria-labelledby="result-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Latest command</p>
          <h2 id="result-heading">Recognition result</h2>
        </div>
        {result && (
          <span className={result.intent.pageId ? "result-state" : "result-state result-state--unknown"}>
            {result.intent.pageId ? "Matched" : "Unknown"}
          </span>
        )}
      </div>

      <div className="result-grid">
        <div className="result-block result-block--wide">
          <span>Recognized text</span>
          <strong>{result ? `“${result.transcript}”` : "—"}</strong>
        </div>
        <div className="result-block">
          <span>Detected page</span>
          <strong className={result && !result.intent.pageId ? "unknown" : "target"}>
            {target}
          </strong>
        </div>
        <div className="result-block response-time">
          <span>Response time</span>
          <strong>
            {result ? `${Math.round(result.metrics.responseTimeMs)} ms` : "—"}
          </strong>
        </div>
      </div>

      {result && !result.intent.pageId && (
        <p className="unknown-message">No matching page detected.</p>
      )}

      <div className="debug-grid">
        <div>
          <span>STT completion</span>
          <strong>{result ? `${result.metrics.sttCompletionTimeMs.toFixed(1)} ms` : "—"}</strong>
        </div>
        <div>
          <span>Intent matching</span>
          <strong>{result ? `${result.metrics.commandProcessingTimeMs.toFixed(2)} ms` : "—"}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{result ? `${Math.round(result.intent.confidence * 100)}%` : "—"}</strong>
        </div>
        <div>
          <span>Matched phrase</span>
          <strong>{result?.intent.matchedPhrase ?? "—"}</strong>
        </div>
      </div>
    </section>
  );
}
