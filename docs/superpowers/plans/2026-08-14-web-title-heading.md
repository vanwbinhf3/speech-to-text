# Web Title and Heading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the browser tab title and primary page heading to the approved product name.

**Architecture:** This is a copy-only change at the two existing presentation entry points: the HTML document metadata and the React H1. A small source-level Vitest regression test will prevent the two labels from diverging again without introducing a DOM test dependency.

**Tech Stack:** React, Vite, TypeScript, Vitest, Node.js file APIs.

## Global Constraints

- The exact approved copy is `Browser ASR Voice Navigation Benchmark`.
- Change only the document title, primary application H1, and their regression test.
- Do not change the subtitle, fallback error heading, benchmark behavior, styling, or dependencies.

---

### Task 1: Synchronize the browser title and primary H1

**Files:**
- Create: `src/appCopy.test.ts`
- Modify: `index.html:10`
- Modify: `src/App.tsx:49`

**Interfaces:**
- Consumes: the approved literal `Browser ASR Voice Navigation Benchmark`.
- Produces: matching browser metadata and visible H1 copy; no runtime API changes.

- [ ] **Step 1: Write the failing regression test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const approvedTitle = "Browser ASR Voice Navigation Benchmark";

describe("application title copy", () => {
  it("uses the approved title in the browser metadata and primary H1", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(html).toContain(`<title>${approvedTitle}</title>`);
    expect(app).toContain(`<h1>${approvedTitle}</h1>`);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- src/appCopy.test.ts`

Expected: FAIL because `index.html` and `src/App.tsx` still contain Moonshine-only titles.

- [ ] **Step 3: Apply the approved copy**

In `index.html`, replace the existing title with:

```html
<title>Browser ASR Voice Navigation Benchmark</title>
```

In `src/App.tsx`, replace the existing primary heading with:

```tsx
<h1>Browser ASR Voice Navigation Benchmark</h1>
```

- [ ] **Step 4: Run verification**

Run:

```bash
npm test -- src/appCopy.test.ts
npm test
npm run build
```

Expected: the focused test passes, all existing tests pass, and Vite completes the production build without TypeScript errors.

- [ ] **Step 5: Commit the implementation**

```bash
git add index.html src/App.tsx src/appCopy.test.ts
git commit -m "feat: rename browser ASR benchmark"
```
