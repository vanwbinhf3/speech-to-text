import type { CommandHistoryItem } from "../types/navigation";

interface CommandHistoryProps {
  history: readonly CommandHistoryItem[];
}

export function CommandHistory({ history }: CommandHistoryProps) {
  return (
    <section className="panel history-panel" aria-labelledby="history-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Session only</p>
          <h2 id="history-heading">Recent commands</h2>
        </div>
        <span className="count-badge">{history.length}/10</span>
      </div>

      {history.length === 0 ? (
        <p className="empty-history">Your latest voice commands will appear here.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Speech</th>
                <th>Page</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>“{item.transcript}”</td>
                  <td>{item.intent.pageName ?? "Unknown"}</td>
                  <td>{Math.round(item.metrics.responseTimeMs)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
