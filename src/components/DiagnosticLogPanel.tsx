import type { DiagnosticLogEntry } from "../services/benchmarkController";

interface DiagnosticLogPanelProps {
  logs: DiagnosticLogEntry[];
}

export function DiagnosticLogPanel({ logs }: DiagnosticLogPanelProps) {
  return (
    <section className="panel diagnostic-log-panel" aria-labelledby="diagnostic-log-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Runtime diagnostics</p>
          <h2 id="diagnostic-log-heading">Speech pipeline log</h2>
        </div>
        <span className="count-badge">{logs.length}/80</span>
      </div>

      {logs.length === 0 ? (
        <p className="empty-history">No runtime logs yet.</p>
      ) : (
        <ol className="diagnostic-log-list" aria-live="polite">
          {[...logs].reverse().map((entry) => (
            <li key={entry.id} className={`diagnostic-log diagnostic-log--${entry.level}`}>
              <span>{entry.level}</span>
              <code>{Math.round(entry.at)} ms</code>
              <p>{entry.message}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
