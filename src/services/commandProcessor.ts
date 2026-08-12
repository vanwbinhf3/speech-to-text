import { detectNavigationIntent } from "./intentMatcher";
import type { CommandHistoryItem } from "../types/navigation";

interface CreateCommandResultInput {
  transcript: string;
  sttCompletionTimeMs: number;
  lineId: string;
  listeningStartedAt: number;
  now?: () => number;
}

export function createCommandResult({
  transcript,
  sttCompletionTimeMs,
  lineId,
  listeningStartedAt,
  now = performance.now.bind(performance),
}: CreateCommandResultInput): CommandHistoryItem {
  const finalTranscriptAt = now();
  const intent = detectNavigationIntent(transcript);
  const intentDetectedAt = now();
  // This measures intent-processing latency after the final transcript
  // becomes available. It is not the total speech-to-action latency.
  const commandProcessingTimeMs = intentDetectedAt - finalTranscriptAt;

  return {
    id: lineId,
    transcript,
    intent,
    metrics: {
      sttCompletionTimeMs,
      commandProcessingTimeMs,
      // Moonshine measures phrase-end -> final transcript. Adding the local
      // matcher time gives the closest available speech-end -> intent metric.
      responseTimeMs: sttCompletionTimeMs + commandProcessingTimeMs,
      listeningStartedAt,
      finalTranscriptAt,
      intentDetectedAt,
    },
  };
}

export function addHistoryItem(
  history: readonly CommandHistoryItem[],
  item: CommandHistoryItem,
): CommandHistoryItem[] {
  return [item, ...history].slice(0, 10);
}
