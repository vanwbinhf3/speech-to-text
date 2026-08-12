import { describe, expect, it } from "vitest";

import {
  addHistoryItem,
  createCommandResult,
} from "./commandProcessor";

describe("createCommandResult", () => {
  it("combines Moonshine STT completion latency with matcher latency", () => {
    const timeline = [1_000, 1_002.75];
    const result = createCommandResult({
      transcript: "open dashboard",
      sttCompletionTimeMs: 84.2,
      lineId: "9007199254740993001",
      listeningStartedAt: 500,
      now: () => timeline.shift() ?? 1_002.75,
    });

    expect(result.intent.pageId).toBe("dashboard");
    expect(result.metrics.commandProcessingTimeMs).toBeCloseTo(2.75);
    expect(result.metrics.responseTimeMs).toBeCloseTo(86.95);
    expect(result.metrics.finalTranscriptAt).toBe(1_000);
    expect(result.metrics.intentDetectedAt).toBe(1_002.75);
  });
});

describe("addHistoryItem", () => {
  it("keeps the newest ten commands", () => {
    const items = Array.from({ length: 11 }, (_, index) =>
      createCommandResult({
        transcript: `open dashboard ${index}`,
        sttCompletionTimeMs: index,
        lineId: String(index),
        listeningStartedAt: 0,
        now: () => index,
      }),
    );

    const history = items.reduce(addHistoryItem, []);

    expect(history).toHaveLength(10);
    expect(history[0].id).toBe("10");
    expect(history.at(-1)?.id).toBe("1");
  });
});
