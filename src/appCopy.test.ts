import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import htmlSource from "../index.html?raw";

const approvedTitle = "Browser ASR Voice Navigation Benchmark";

describe("application title copy", () => {
  it("uses the approved title in the browser metadata and primary H1", () => {
    expect(htmlSource).toContain(`<title>${approvedTitle}</title>`);
    expect(appSource).toContain(`<h1>${approvedTitle}</h1>`);
  });
});
