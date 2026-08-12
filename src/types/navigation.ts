export interface NavigationPage {
  id: string;
  name: string;
  aliases: readonly string[];
}

export interface NavigationIntent {
  pageId: string | null;
  pageName: string | null;
  confidence: number;
  matchedPhrase?: string;
}

export interface CommandMetrics {
  sttCompletionTimeMs: number;
  commandProcessingTimeMs: number;
  responseTimeMs: number;
  listeningStartedAt: number;
  finalTranscriptAt: number;
  intentDetectedAt: number;
}

export interface CommandHistoryItem {
  id: string;
  transcript: string;
  intent: NavigationIntent;
  metrics: CommandMetrics;
}

export type ModelId = "moonshine" | "whisper";

export interface ModelBenchmarkMetrics {
  sttCompletionTimeMs: number | null;
  inferenceTimeMs: number | null;
  postStopSttTimeMs: number | null;
  modelAudioReceivedAt: number;
  modelResultReadyAt: number;
  modelProcessingTimeMs: number;
  commandProcessingTimeMs: number;
  commandReadyAfterStopMs: number;
  startToCommandReadyMs: number;
  recordingStartedAt: number;
  recordingStoppedAt: number;
  transcriptReadyAt: number;
  intentDetectedAt: number;
  inferenceStartedAt: number | null;
}

export interface ModelBenchmarkResult {
  modelId: ModelId;
  lineId: string;
  transcript: string;
  intent: NavigationIntent;
  metrics: ModelBenchmarkMetrics;
  correct: boolean | null;
  error?: string;
}

export interface BenchmarkHistoryRun {
  id: string;
  startedAt: number;
  stoppedAt: number;
  expectedPageId: string | null;
  moonshine: ModelBenchmarkResult | null;
  whisper: ModelBenchmarkResult | null;
}

export interface ModelSummary {
  averageCommandReadyAfterStopMs: number | null;
  medianCommandReadyAfterStopMs: number | null;
  averageModelProcessingTimeMs: number | null;
  medianModelProcessingTimeMs: number | null;
  accuracy: {
    correct: number;
    total: number;
    percentage: number;
  } | null;
}

export interface BenchmarkSummary {
  moonshine: ModelSummary;
  whisper: ModelSummary;
}
