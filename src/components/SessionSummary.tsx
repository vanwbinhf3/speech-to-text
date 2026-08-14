import type { BenchmarkSummary, ModelSummary } from "../types/navigation";

interface SessionSummaryProps {
  summary: BenchmarkSummary;
}

export function SessionSummary({ summary }: SessionSummaryProps) {
  return (
    <section className="panel summary-panel" aria-labelledby="summary-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Session aggregates</p>
          <h2 id="summary-heading">Tiny vs Small vs Medium</h2>
        </div>
      </div>
      <div className="summary-grid">
        <SummaryCard name="Tiny Streaming" summary={summary.tinyStreaming} />
        <SummaryCard name="Small Streaming" summary={summary.smallStreaming} />
        <SummaryCard name="Medium Streaming" summary={summary.mediumStreaming} />
      </div>
    </section>
  );
}

function SummaryCard({ name, summary }: { name: string; summary: ModelSummary }) {
  return (
    <div className="summary-card">
      <strong>{name}</strong>
      <span>
        Average timer: {summary.averageModelProcessingTimeMs === null ? "-" : `${summary.averageModelProcessingTimeMs} ms`}
      </span>
      <span>
        Median timer: {summary.medianModelProcessingTimeMs === null ? "-" : `${summary.medianModelProcessingTimeMs} ms`}
      </span>
      <span>
        Accuracy: {summary.accuracy ? `${summary.accuracy.correct}/${summary.accuracy.total} (${summary.accuracy.percentage}%)` : "-"}
      </span>
    </div>
  );
}
