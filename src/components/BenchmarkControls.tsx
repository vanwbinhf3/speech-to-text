import { pages } from "../config/pages";
import type { AudioProcessingConfig, BrowserProcessingMode } from "../services/audioCaptureService";

interface BenchmarkControlsProps {
  status: string;
  partialTranscript: string;
  inputVolume: number;
  inputPeakVolume: number;
  audioProcessingConfig: AudioProcessingConfig;
  expectedPageId: string | null;
  canStart: boolean;
  running: boolean;
  onExpectedPageChange: (pageId: string | null) => void;
  onAudioProcessingConfigChange: (patch: Partial<AudioProcessingConfig>) => void;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}

export function BenchmarkControls({
  status,
  partialTranscript,
  inputVolume,
  inputPeakVolume,
  audioProcessingConfig,
  expectedPageId,
  canStart,
  running,
  onExpectedPageChange,
  onAudioProcessingConfigChange,
  onStart,
  onStop,
  onReset,
}: BenchmarkControlsProps) {
  const rmsPercent = Math.round(inputVolume * 100);
  const peakPercent = Math.round(inputPeakVolume * 100);

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

      <div className="audio-settings" aria-label="Audio quality controls">
        <label className="field-label">
          Input gain
          <div className="range-field">
            <input
              type="range"
              min="1"
              max="4"
              step="0.25"
              value={audioProcessingConfig.inputGain}
              onChange={(event) =>
                onAudioProcessingConfigChange({
                  inputGain: Number(event.target.value),
                })
              }
              disabled={running}
            />
            <strong>{audioProcessingConfig.inputGain.toFixed(2)}x</strong>
          </div>
        </label>

        <label className="field-label">
          Browser processing
          <select
            value={audioProcessingConfig.browserProcessingMode}
            onChange={(event) =>
              onAudioProcessingConfigChange({
                browserProcessingMode: event.target.value as BrowserProcessingMode,
              })
            }
            disabled={running}
          >
            <option value="enhanced">Enhanced microphone</option>
            <option value="raw">Raw microphone</option>
          </select>
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={audioProcessingConfig.noiseGateEnabled}
            onChange={(event) =>
              onAudioProcessingConfigChange({
                noiseGateEnabled: event.target.checked,
              })
            }
            disabled={running}
          />
          <span>Noise gate</span>
        </label>
      </div>

      <div className={`microphone-orb${running ? " microphone-orb--live" : ""}`} aria-hidden="true">
        <span>Mic</span>
      </div>

      <div className="volume-meter" aria-label="Input volume">
        <div className="volume-meter__header">
          <span>Input volume</span>
          <strong>RMS {rmsPercent}% · Peak {peakPercent}%</strong>
        </div>
        <div
          className="volume-meter__track"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rmsPercent}
        >
          <span style={{ width: `${rmsPercent}%` }} />
          <em style={{ left: `${peakPercent}%` }} aria-hidden="true" />
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
        <span>Streaming partial</span>
        <p>{partialTranscript ? `"${partialTranscript}"` : "Moonshine disabled; Whisper returns text after silence or Stop."}</p>
      </div>
    </section>
  );
}
