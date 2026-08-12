import { describe, expect, it } from "vitest";

import {
  detectNavigationIntent,
  normalizeTranscript,
} from "./intentMatcher";

describe("normalizeTranscript", () => {
  it("lowercases, removes punctuation, trims, and collapses whitespace", () => {
    expect(normalizeTranscript("  Can You OPEN   the Dashboard?! ")).toBe(
      "can you open the dashboard",
    );
  });
});

describe("detectNavigationIntent", () => {
  const examples: Array<[string, string]> = [
    ["open dashboard", "dashboard"],
    ["can you show me my dashboard", "dashboard"],
    ["navigate to the main dashboard", "dashboard"],
    ["open projects", "projects"],
    ["show me my projects", "projects"],
    ["take me to the project page", "projects"],
    ["open tasks", "tasks"],
    ["show my tasks", "tasks"],
    ["take me to the task list", "tasks"],
    ["open workload", "workload"],
    ["show my workload", "workload"],
    ["open workload dashboard", "workload"],
    ["show employee workload", "workload"],
    ["open employees", "employees"],
    ["show team members", "employees"],
    ["show the employee list", "employees"],
    ["open analytics", "analytics"],
    ["show reports", "analytics"],
    ["open analytics dashboard", "analytics"],
    ["show performance analytics", "analytics"],
    ["open settings", "settings"],
    ["go to application settings", "settings"],
    ["show app settings", "settings"],
    ["open integrations", "integrations"],
    ["open GitHub integration", "integrations"],
    ["show OpenProject integration", "integrations"],
    ["open integration settings", "integrations"],
    ["could you show me the analitics page", "analytics"],
    ["please open the work load page", "workload"],
  ];

  it.each(examples)("maps %j to %s", (transcript, pageId) => {
    expect(detectNavigationIntent(transcript).pageId).toBe(pageId);
  });

  it.each([
    "I don't know what I should do today",
    "the weather is nice today",
    "we discussed a project deadline",
    "please open something useful",
    "",
  ])("does not force-match %j", (transcript) => {
    expect(detectNavigationIntent(transcript).pageId).toBeNull();
  });

  it("returns debug information for a confident match", () => {
    const result = detectNavigationIntent(
      "could you please show me the workload dashboard",
    );

    expect(result).toMatchObject({
      pageId: "workload",
      pageName: "Workload",
      matchedPhrase: "workload dashboard",
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
