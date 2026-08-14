import { MOONSHINE_MODELS } from "../services/moonshineService";
import type { BenchmarkHistoryRun } from "../types/navigation";

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
                <th>Model</th>
                <th>Speech</th>
                <th>Page</th>
                <th>Timer</th>
                <th>Expected</th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => {
                const result = run.moonshine;
                return (
                  <tr key={run.id}>
                    <td>{run.id}</td>
                    <td>{result?.modelVariant ? MOONSHINE_MODELS[result.modelVariant].name.replace("Moonshine ", "") : "-"}</td>
                    <td>{result ? `"${result.transcript}"` : "-"}</td>
                    <td>{result?.intent.pageName ?? (result ? "Unknown" : "-")}</td>
                    <td>{result ? `${Math.round(result.metrics.modelProcessingTimeMs)} ms` : "-"}</td>
                    <td>{run.expectedPageId ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
