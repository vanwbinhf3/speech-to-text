interface VoiceControlProps {
  modelStatus: "loading" | "ready" | "error";
  modelProgress: number | null;
  modelFile: string;
  listening: boolean;
  status: string;
  partialTranscript: string;
  onToggle: () => void;
  onReset: () => void;
}

export function VoiceControl({
  modelStatus,
  modelProgress,
  modelFile,
  listening,
  status,
  partialTranscript,
  onToggle,
  onReset,
}: VoiceControlProps) {
  const loading = modelStatus === "loading";

  return (
    <section className="panel voice-panel" aria-labelledby="microphone-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">On-device recognition</p>
          <h2 id="microphone-heading">Microphone</h2>
        </div>
        <span className={`status-dot${listening ? " status-dot--live" : ""}`}>
          {listening ? "Live" : modelStatus === "ready" ? "Model ready" : "Loading"}
        </span>
      </div>

      <div className={`microphone-orb${listening ? " microphone-orb--live" : ""}`}>
        <span aria-hidden="true">🎙️</span>
      </div>

      <div className="voice-actions">
        <button
          className={`primary-button${listening ? " primary-button--stop" : ""}`}
          type="button"
          onClick={onToggle}
          disabled={loading || modelStatus === "error"}
        >
          {loading
            ? "Loading model…"
            : listening
              ? "Stop Listening"
              : "Start Listening"}
        </button>
        <button className="secondary-button" type="button" onClick={onReset}>
          Reset
        </button>
      </div>

      {loading && (
        <div className="load-progress" aria-live="polite">
          <div className="progress-track">
            <span
              className={modelProgress === null ? "progress-indeterminate" : ""}
              style={
                modelProgress === null
                  ? undefined
                  : { width: `${Math.max(3, modelProgress * 100)}%` }
              }
            />
          </div>
          <small>{modelFile ? `Loading ${modelFile}` : "Preparing WebAssembly runtime"}</small>
        </div>
      )}

      <div className="status-box" aria-live="polite">
        <span>Status</span>
        <strong>{status}</strong>
      </div>

      <div className="partial-box">
        <span>Live transcript</span>
        <p>{partialTranscript ? `“${partialTranscript}”` : "—"}</p>
      </div>
    </section>
  );
}
