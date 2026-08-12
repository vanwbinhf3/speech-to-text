import type { WhisperProgress } from "../services/whisperService";

interface ModelStatusPanelProps {
  moonshineStatus: string;
  whisperStatus: string;
  moonshineError: string | null;
  whisperError: string | null;
  whisperProgress: WhisperProgress | null;
  onRetry: () => void;
}

export function ModelStatusPanel({
  moonshineStatus,
  whisperStatus,
  moonshineError,
  whisperError,
  whisperProgress,
  onRetry,
}: ModelStatusPanelProps) {
  return (
    <section className="panel model-status-panel" aria-labelledby="models-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Browser ASR</p>
          <h2 id="models-heading">Model status</h2>
        </div>
        {(moonshineError || whisperError) && (
          <button className="secondary-button" type="button" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
      <div className="model-status-grid">
        <ModelStatusCard
          name="Moonshine Tiny Streaming"
          status={moonshineStatus}
          detail={moonshineError ?? "Temporarily disabled for Whisper-only testing"}
        />
        <ModelStatusCard
          name="Whisper.cpp base.en Q5_1"
          status={whisperStatus}
          detail={
            whisperError ??
            (whisperProgress
              ? `${Math.round(whisperProgress.fraction * 100)}% ${whisperProgress.file}`
              : whisperStatus === "idle"
                ? "Waiting to load Whisper runtime and model"
                : "Self-hosted runtime and model")
          }
        />
      </div>
    </section>
  );
}

function ModelStatusCard({
  name,
  status,
  detail,
}: {
  name: string;
  status: string;
  detail: string;
}) {
  return (
    <div className={`model-status-card model-status-card--${status}`}>
      <span>{status}</span>
      <strong>{name}</strong>
      <p>{detail}</p>
    </div>
  );
}
