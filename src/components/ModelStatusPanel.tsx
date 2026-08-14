import type { MoonshineProgress } from "../services/benchmarkController";
import type { WhisperProgress } from "../services/whisperService";
import {
  MOONSHINE_MODELS,
  type MoonshineModelVariant,
} from "../services/moonshineService";

interface ModelStatusPanelProps {
  selectedModel: MoonshineModelVariant;
  moonshineStatus: string;
  moonshineError: string | null;
  moonshineProgress: MoonshineProgress | null;
  whisperStatus: string;
  whisperError: string | null;
  whisperProgress: WhisperProgress | null;
  selectionDisabled: boolean;
  onModelChange: (variant: MoonshineModelVariant) => void;
  onRetry: () => void;
}

export function ModelStatusPanel({
  selectedModel,
  moonshineStatus,
  moonshineError,
  moonshineProgress,
  whisperStatus,
  whisperError,
  whisperProgress,
  selectionDisabled,
  onModelChange,
  onRetry,
}: ModelStatusPanelProps) {
  const selected = MOONSHINE_MODELS[selectedModel];
  const progressDetail = moonshineProgress
    ? `${Math.round(moonshineProgress.fraction * 100)}% · ${moonshineProgress.file}`
    : null;
  const whisperProgressDetail = whisperProgress
    ? `${Math.round(whisperProgress.fraction * 100)}% · ${whisperProgress.file}`
    : null;

  return (
    <section className="panel model-status-panel" aria-labelledby="models-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Browser ASR</p>
          <h2 id="models-heading">Model status</h2>
        </div>
        {moonshineError && (
          <button className="secondary-button" type="button" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>

      <label className="field-label model-selector">
        Moonshine model
        <select
          value={selectedModel}
          disabled={selectionDisabled}
          onChange={(event) =>
            onModelChange(event.target.value as MoonshineModelVariant)
          }
        >
          {Object.entries(MOONSHINE_MODELS).map(([variant, model]) => (
            <option key={variant} value={variant}>
              {model.name} ({model.parameters})
            </option>
          ))}
        </select>
      </label>

      <div className="model-status-grid">
        <div className={`model-status-card model-status-card--${moonshineStatus}`}>
          <span>{moonshineStatus}</span>
          <strong>{selected.name}</strong>
          <p>
            {moonshineError ??
              progressDetail ??
              (moonshineStatus === "idle"
                ? "Waiting to load the selected English streaming model"
                : "Moonshine CDN asset cached by the browser after first load")}
          </p>
          {moonshineStatus === "loading" && moonshineProgress && (
            <div className="load-progress" aria-label="Model download progress">
              <div className="progress-track">
                <span style={{ width: `${moonshineProgress.fraction * 100}%` }} />
              </div>
            </div>
          )}
        </div>
        <div className={`model-status-card model-status-card--${whisperStatus}`}>
          <span>{whisperStatus}</span>
          <strong>Whisper Base.en Q5_1</strong>
          <p>
            {whisperError ??
              whisperProgressDetail ??
              (whisperStatus === "idle"
                ? "Loads only after Moonshine returns its final transcript"
                : "Runs on the complete buffered recording after Moonshine")}
          </p>
          {whisperStatus === "loading" && whisperProgress && (
            <div className="load-progress" aria-label="Whisper download progress">
              <div className="progress-track">
                <span style={{ width: `${whisperProgress.fraction * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
