import { describe, expect, it } from "vitest";

import {
  addBenchmarkHistoryItem,
  createModelBenchmarkResult,
  summarizeBenchmarkHistory,
} from "./benchmarkMetrics";
import type { BenchmarkHistoryRun } from "../types/navigation";

describe("createModelBenchmarkResult", () => {
  it("clamps command ready after stop when streaming result is early", () => {
    const result = createModelBenchmarkResult({
      modelId: "moonshine",
      transcript: "open dashboard",
      lineId: "line-1",
      recordingStartedAt: 100,
      recordingStoppedAt: 1_000,
      transcriptReadyAt: 900,
      intentDetectedAt: 910,
      sttCompletionTimeMs: 280,
      inferenceStartedAt: null,
      commandProcessingTimeMs: 10,
      expectedPageId: "dashboard",
    });

    expect(result.intent.pageId).toBe("dashboard");
    expect(result.metrics.commandReadyAfterStopMs).toBe(0);
    expect(result.metrics.startToCommandReadyMs).toBe(810);
    expect(result.correct).toBe(true);
  });

  it("computes Whisper inference and post-stop latency", () => {
    const result = createModelBenchmarkResult({
      modelId: "whisper",
      transcript: "open settings",
      lineId: "request-1",
      recordingStartedAt: 100,
      recordingStoppedAt: 700,
      transcriptReadyAt: 950,
      intentDetectedAt: 952,
      sttCompletionTimeMs: null,
      inferenceStartedAt: 720,
      commandProcessingTimeMs: 2,
      expectedPageId: "settings",
    });

    expect(result.intent.pageId).toBe("settings");
    expect(result.metrics.inferenceTimeMs).toBe(230);
    expect(result.metrics.postStopSttTimeMs).toBe(250);
    expect(result.metrics.commandReadyAfterStopMs).toBe(252);
    expect(result.correct).toBe(true);
  });

  it("computes model-local processing time from audio received to result ready", () => {
    const result = createModelBenchmarkResult({
      modelId: "whisper",
      transcript: "open settings",
      lineId: "request-1",
      recordingStartedAt: 100,
      recordingStoppedAt: 700,
      transcriptReadyAt: 950,
      intentDetectedAt: 952,
      sttCompletionTimeMs: null,
      inferenceStartedAt: 720,
      commandProcessingTimeMs: 2,
      expectedPageId: "settings",
      modelAudioReceivedAt: 730,
      modelResultReadyAt: 960,
    } as Parameters<typeof createModelBenchmarkResult>[0] & {
      modelAudioReceivedAt: number;
      modelResultReadyAt: number;
    });

    expect(result.metrics.modelAudioReceivedAt).toBe(730);
    expect(result.metrics.modelResultReadyAt).toBe(960);
    expect(result.metrics.modelProcessingTimeMs).toBe(230);
  });

  it("marks unlabeled results without adding correctness", () => {
    const result = createModelBenchmarkResult({
      modelId: "moonshine",
      transcript: "open workload",
      lineId: "line-2",
      recordingStartedAt: 0,
      recordingStoppedAt: 100,
      transcriptReadyAt: 130,
      intentDetectedAt: 132,
      sttCompletionTimeMs: 30,
      inferenceStartedAt: null,
      commandProcessingTimeMs: 2,
      expectedPageId: null,
    });

    expect(result.correct).toBeNull();
  });
});

describe("addBenchmarkHistoryItem", () => {
  it("caps benchmark history at newest 20", () => {
    const history = Array.from({ length: 25 }, (_, index) => ({
      id: `run-${index}`,
      startedAt: index,
      stoppedAt: index + 1,
      expectedPageId: null,
      moonshine: null,
      whisper: null,
    })).reduce<BenchmarkHistoryRun[]>(
      (items, item) => addBenchmarkHistoryItem(items, item),
      [],
    );

    expect(history).toHaveLength(20);
    expect(history[0].id).toBe("run-24");
    expect(history.at(-1)?.id).toBe("run-5");
  });
});

describe("summarizeBenchmarkHistory", () => {
  it("summarizes average median and labeled accuracy per model", () => {
    const history: BenchmarkHistoryRun[] = [
      {
        id: "run-2",
        startedAt: 0,
        stoppedAt: 1,
        expectedPageId: "settings",
        moonshine: createModelBenchmarkResult({
          modelId: "moonshine",
          transcript: "open settings",
          lineId: "m2",
          recordingStartedAt: 0,
          recordingStoppedAt: 100,
          transcriptReadyAt: 250,
          intentDetectedAt: 300,
          sttCompletionTimeMs: 140,
          inferenceStartedAt: null,
          commandProcessingTimeMs: 50,
          expectedPageId: "settings",
        }),
        whisper: createModelBenchmarkResult({
          modelId: "whisper",
          transcript: "open settings",
          lineId: "w2",
          recordingStartedAt: 0,
          recordingStoppedAt: 100,
          transcriptReadyAt: 190,
          intentDetectedAt: 200,
          sttCompletionTimeMs: null,
          inferenceStartedAt: 110,
          commandProcessingTimeMs: 10,
          expectedPageId: "settings",
        }),
      },
      {
        id: "run-1",
        startedAt: 0,
        stoppedAt: 1,
        expectedPageId: "dashboard",
        moonshine: createModelBenchmarkResult({
          modelId: "moonshine",
          transcript: "open tasks",
          lineId: "m1",
          recordingStartedAt: 0,
          recordingStoppedAt: 100,
          transcriptReadyAt: 160,
          intentDetectedAt: 200,
          sttCompletionTimeMs: 50,
          inferenceStartedAt: null,
          commandProcessingTimeMs: 40,
          expectedPageId: "dashboard",
        }),
        whisper: null,
      },
    ];

    const summary = summarizeBenchmarkHistory(history);

    expect(summary.moonshine.averageCommandReadyAfterStopMs).toBe(150);
    expect(summary.moonshine.medianCommandReadyAfterStopMs).toBe(150);
    expect(summary.moonshine.averageModelProcessingTimeMs).toBe(205);
    expect(summary.moonshine.medianModelProcessingTimeMs).toBe(205);
    expect(summary.moonshine.accuracy).toEqual({
      correct: 1,
      total: 2,
      percentage: 50,
    });
    expect(summary.whisper.averageCommandReadyAfterStopMs).toBe(100);
    expect(summary.whisper.averageModelProcessingTimeMs).toBe(190);
    expect(summary.whisper.medianModelProcessingTimeMs).toBe(190);
    expect(summary.whisper.accuracy).toEqual({
      correct: 1,
      total: 1,
      percentage: 100,
    });
  });
});
