import { detectNavigationIntent } from "./intentMatcher";
import type {
  BenchmarkHistoryRun,
  BenchmarkSummary,
  ModelBenchmarkResult,
  ModelId,
  ModelSummary,
} from "../types/navigation";

export interface CreateModelBenchmarkResultInput {
  modelId: ModelId;
  transcript: string;
  lineId: string;
  recordingStartedAt: number;
  recordingStoppedAt: number;
  transcriptReadyAt: number;
  intentDetectedAt?: number;
  sttCompletionTimeMs: number | null;
  inferenceStartedAt: number | null;
  modelAudioReceivedAt?: number;
  modelResultReadyAt?: number;
  commandProcessingTimeMs?: number;
  expectedPageId: string | null;
  now?: () => number;
}

export function createModelBenchmarkResult({
  modelId,
  transcript,
  lineId,
  recordingStartedAt,
  recordingStoppedAt,
  transcriptReadyAt,
  intentDetectedAt,
  sttCompletionTimeMs,
  inferenceStartedAt,
  modelAudioReceivedAt,
  modelResultReadyAt,
  commandProcessingTimeMs,
  expectedPageId,
  now = performance.now.bind(performance),
}: CreateModelBenchmarkResultInput): ModelBenchmarkResult {
  const matcherStart = now();
  const intent = detectNavigationIntent(transcript);
  const matcherEnd = now();
  const resolvedIntentDetectedAt = intentDetectedAt ?? matcherEnd;
  const resolvedCommandProcessingTimeMs =
    commandProcessingTimeMs ?? matcherEnd - matcherStart;
  const resolvedModelAudioReceivedAt = modelAudioReceivedAt ?? recordingStartedAt;
  const resolvedModelResultReadyAt = modelResultReadyAt ?? transcriptReadyAt;
  const detectedPageId = intent.pageId;
  const correct =
    expectedPageId === null ? null : detectedPageId === expectedPageId;

  return {
    modelId,
    lineId,
    transcript,
    intent,
    correct,
    metrics: {
      sttCompletionTimeMs,
      inferenceStartedAt,
      inferenceTimeMs:
        inferenceStartedAt === null ? null : transcriptReadyAt - inferenceStartedAt,
      postStopSttTimeMs:
        modelId === "whisper" ? transcriptReadyAt - recordingStoppedAt : null,
      modelAudioReceivedAt: resolvedModelAudioReceivedAt,
      modelResultReadyAt: resolvedModelResultReadyAt,
      modelProcessingTimeMs:
        resolvedModelResultReadyAt - resolvedModelAudioReceivedAt,
      commandProcessingTimeMs: resolvedCommandProcessingTimeMs,
      commandReadyAfterStopMs: Math.max(
        0,
        resolvedIntentDetectedAt - recordingStoppedAt,
      ),
      startToCommandReadyMs: resolvedIntentDetectedAt - recordingStartedAt,
      recordingStartedAt,
      recordingStoppedAt,
      transcriptReadyAt,
      intentDetectedAt: resolvedIntentDetectedAt,
    },
  };
}

export function addBenchmarkHistoryItem(
  history: readonly BenchmarkHistoryRun[],
  item: BenchmarkHistoryRun,
): BenchmarkHistoryRun[] {
  return [item, ...history].slice(0, 20);
}

export function summarizeBenchmarkHistory(
  history: readonly BenchmarkHistoryRun[],
): BenchmarkSummary {
  return {
    moonshine: summarizeModel(history, "moonshine"),
    whisper: summarizeModel(history, "whisper"),
  };
}

function summarizeModel(
  history: readonly BenchmarkHistoryRun[],
  modelId: ModelId,
): ModelSummary {
  const results = history
    .map((run) => run[modelId])
    .filter((result): result is ModelBenchmarkResult => result !== null);
  const latencies = results.map(
    (result) => result.metrics.commandReadyAfterStopMs,
  );
  const modelProcessingTimes = results.map(
    (result) => result.metrics.modelProcessingTimeMs,
  );
  const labeled = results.filter((result) => result.correct !== null);
  const correct = labeled.filter((result) => result.correct === true).length;

  return {
    averageCommandReadyAfterStopMs: average(latencies),
    medianCommandReadyAfterStopMs: median(latencies),
    averageModelProcessingTimeMs: average(modelProcessingTimes),
    medianModelProcessingTimeMs: median(modelProcessingTimes),
    accuracy:
      labeled.length === 0
        ? null
        : {
            correct,
            total: labeled.length,
            percentage: Math.round((correct / labeled.length) * 100),
          },
  };
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[middle]);
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
