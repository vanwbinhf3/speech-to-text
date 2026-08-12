import type { BenchmarkHistoryRun, ModelBenchmarkResult } from "../types/navigation";

interface BenchmarkHistoryProps {
  history: BenchmarkHistoryRun[];
}

export function BenchmarkHistory({ history }: BenchmarkHistoryProps) {
  return (
    <section className="panel history-panel" aria-labelledby="history-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Recent commands</p>
          <h2 id="history-heading">Benchmark history</h2>
        </div>
        <span className="count-badge">{history.length}/20</span>
      </div>

      {history.length === 0 ? (
        <p className="empty-history">No benchmark runs yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Moonshine</th>
                <th>Whisper</th>
                <th>Expected</th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => (
                <tr key={run.id}>
                  <td>{run.id}</td>
                  <td>{formatResult(run.moonshine)}</td>
                  <td>{formatResult(run.whisper)}</td>
                  <td>{run.expectedPageId ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatResult(result: ModelBenchmarkResult | null): string {
  if (!result) return "-";
  const page = result.intent.pageName ?? "Unknown";
  return `${page} / ${Math.round(result.metrics.modelProcessingTimeMs)} ms`;
}
