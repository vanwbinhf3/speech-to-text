import type { BenchmarkSummary } from "../types/navigation";

interface SessionSummaryProps {
  summary: BenchmarkSummary;
}

export function SessionSummary({ summary }: SessionSummaryProps) {
  return (
    <section className="panel summary-panel" aria-labelledby="summary-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Session aggregates</p>
          <h2 id="summary-heading">Model timer and accuracy</h2>
        </div>
      </div>
      <div className="summary-grid">
        <SummaryCard name="Moonshine" summary={summary.moonshine} />
        <SummaryCard name="Whisper" summary={summary.whisper} />
      </div>
    </section>
  );
}

function SummaryCard({
  name,
  summary,
}: {
  name: string;
  summary: BenchmarkSummary["moonshine"];
}) {
  return (
    <div className="summary-card">
      <strong>{name}</strong>
      <span>
        Avg timer:{" "}
        {summary.averageModelProcessingTimeMs === null
          ? "-"
          : `${summary.averageModelProcessingTimeMs} ms`}
      </span>
      <span>
        Median timer:{" "}
        {summary.medianModelProcessingTimeMs === null
          ? "-"
          : `${summary.medianModelProcessingTimeMs} ms`}
      </span>
      <span>
        Accuracy:{" "}
        {summary.accuracy
          ? `${summary.accuracy.correct}/${summary.accuracy.total} (${summary.accuracy.percentage}%)`
          : "-"}
      </span>
    </div>
  );
}
