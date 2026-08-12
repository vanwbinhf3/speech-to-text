import { pages } from "../config/pages";

interface BenchmarkControlsProps {
  status: string;
  partialTranscript: string;
  inputVolume: number;
  expectedPageId: string | null;
  canStart: boolean;
  running: boolean;
  onExpectedPageChange: (pageId: string | null) => void;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}

export function BenchmarkControls({
  status,
  partialTranscript,
  inputVolume,
  expectedPageId,
  canStart,
  running,
  onExpectedPageChange,
  onStart,
  onStop,
  onReset,
}: BenchmarkControlsProps) {
  return (
    <section className="panel controls-panel" aria-labelledby="controls-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Shared microphone</p>
          <h2 id="controls-heading">Benchmark control</h2>
        </div>
        <span className={`status-dot${running ? " status-dot--live" : ""}`}>
          {running ? "Recording" : status}
        </span>
      </div>

      <label className="field-label">
        Expected page
        <select
          value={expectedPageId ?? ""}
          onChange={(event) => onExpectedPageChange(event.target.value || null)}
          disabled={running}
        >
          <option value="">Unlabeled</option>
          {pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.name}
            </option>
          ))}
        </select>
      </label>

      <div className={`microphone-orb${running ? " microphone-orb--live" : ""}`} aria-hidden="true">
        <span>Mic</span>
      </div>

      <div className="volume-meter" aria-label="Input volume">
        <div className="volume-meter__header">
          <span>Input volume</span>
          <strong>{Math.round(inputVolume * 100)}%</strong>
        </div>
        <div
          className="volume-meter__track"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(inputVolume * 100)}
        >
          <span style={{ width: `${Math.round(inputVolume * 100)}%` }} />
        </div>
      </div>

      <div className="voice-actions">
        <button
          className={`primary-button${running ? " primary-button--stop" : ""}`}
          type="button"
          onClick={running ? onStop : onStart}
          disabled={!running && !canStart}
        >
          {running ? "Stop Benchmark" : "Start Benchmark"}
        </button>
        <button className="secondary-button" type="button" onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="partial-box">
        <span>Moonshine partial</span>
        <p>{partialTranscript ? `"${partialTranscript}"` : "-"}</p>
      </div>
    </section>
  );
}
