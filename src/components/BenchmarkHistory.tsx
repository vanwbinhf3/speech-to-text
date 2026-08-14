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
                <th>Moonshine model</th>
                <th>Moonshine speech</th>
                <th>Moonshine page</th>
                <th>Moonshine timer</th>
                <th>Whisper speech</th>
                <th>Whisper page</th>
                <th>Whisper timer</th>
                <th>Expected</th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => {
                const moonshine = run.moonshine;
                const whisper = run.whisper;
                return (
                  <tr key={run.id}>
                    <td>{run.id}</td>
                    <td>{moonshine?.modelVariant ? MOONSHINE_MODELS[moonshine.modelVariant].name.replace("Moonshine ", "") : "-"}</td>
                    <td>{moonshine ? `"${moonshine.transcript}"` : "-"}</td>
                    <td>{moonshine?.intent.pageName ?? (moonshine ? "Unknown" : "-")}</td>
                    <td>{moonshine ? `${Math.round(moonshine.metrics.modelProcessingTimeMs)} ms` : "-"}</td>
                    <td>{whisper ? `"${whisper.transcript}"` : "-"}</td>
                    <td>{whisper?.intent.pageName ?? (whisper ? "Unknown" : "-")}</td>
                    <td>{whisper ? `${Math.round(whisper.metrics.modelProcessingTimeMs)} ms` : "-"}</td>
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
