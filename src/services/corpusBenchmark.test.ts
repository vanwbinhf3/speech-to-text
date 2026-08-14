import { describe, expect, it } from "vitest";
import {
  normalizeBenchmarkText,
  summarizeCorpusResults,
  wordErrorRate,
  type CorpusBenchmarkObservation,
} from "./corpusBenchmark";

describe("corpus benchmark metrics", () => {
  it("normalizes case, punctuation, and repeated whitespace", () => {
    expect(normalizeBenchmarkText("  Can YOU open,   Tasks?! ")).toBe(
      "can you open tasks",
    );
  });

  it("calculates word error rate from word edit distance", () => {
    expect(wordErrorRate("open the dashboard", "open dashboard")).toBeCloseTo(
      1 / 3,
    );
    expect(wordErrorRate("open tasks", "open tasks")).toBe(0);
  });

  it("summarizes transcript, intent, unknown, latency, and failures", () => {
    const rows: CorpusBenchmarkObservation[] = [
      observation("1", "open tasks", "open tasks", "tasks", "tasks", 100),
      observation("2", "show settings", "show setting", "settings", "settings", 200),
      observation("3", "what time is it", "what time is it", null, "dashboard", 300),
      {
        ...observation("4", "open projects", "", "projects", null, 0),
        error: "timeout",
        latencyMs: null,
      },
    ];

    expect(summarizeCorpusResults(rows)).toEqual({
      runs: 4,
      successfulRuns: 3,
      failures: 1,
      exactMatchRate: 2 / 4,
      averageWer: (0 + 0.5 + 0 + 1) / 4,
      intentAccuracy: 2 / 4,
      unknownFalsePositiveRate: 1,
      medianLatencyMs: 200,
      p95LatencyMs: 300,
    });
  });

  it("uses the average of the two middle values for an even-sized median", () => {
    const rows = [100, 200, 300, 400].map((latency, index) =>
      observation(
        String(index),
        "open tasks",
        "open tasks",
        "tasks",
        "tasks",
        latency,
      ),
    );

    expect(summarizeCorpusResults(rows).medianLatencyMs).toBe(250);
    expect(summarizeCorpusResults(rows).p95LatencyMs).toBe(400);
  });
});

function observation(
  commandId: string,
  expectedTranscript: string,
  transcript: string,
  expectedPageId: string | null,
  detectedPageId: string | null,
  latencyMs: number,
): CorpusBenchmarkObservation {
  return {
    commandId,
    model: "small-streaming",
    expectedTranscript,
    transcript,
    expectedPageId,
    detectedPageId,
    latencyMs,
    error: null,
  };
}
