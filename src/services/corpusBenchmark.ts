export type CorpusBenchmarkModel =
  | "small-streaming"
  | "medium-streaming"
  | "whisper-base-en-q5_1";

export interface CorpusBenchmarkObservation {
  commandId: string;
  model: CorpusBenchmarkModel;
  expectedTranscript: string;
  transcript: string;
  expectedPageId: string | null;
  detectedPageId: string | null;
  latencyMs: number | null;
  error: string | null;
}

export interface CorpusBenchmarkSummary {
  runs: number;
  successfulRuns: number;
  failures: number;
  exactMatchRate: number;
  averageWer: number;
  intentAccuracy: number;
  unknownFalsePositiveRate: number;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export function normalizeBenchmarkText(text: string): string {
  return text
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function wordErrorRate(reference: string, hypothesis: string): number {
  const expected = tokenize(reference);
  const actual = tokenize(hypothesis);
  if (expected.length === 0) return actual.length === 0 ? 0 : 1;
  return editDistance(expected, actual) / expected.length;
}

export function summarizeCorpusResults(
  rows: readonly CorpusBenchmarkObservation[],
): CorpusBenchmarkSummary {
  const failures = rows.filter((row) => row.error !== null).length;
  const unknownRows = rows.filter((row) => row.expectedPageId === null);
  const latencies = rows
    .flatMap((row) => (row.latencyMs === null ? [] : [row.latencyMs]))
    .sort((left, right) => left - right);

  return {
    runs: rows.length,
    successfulRuns: rows.length - failures,
    failures,
    exactMatchRate: ratio(
      rows.filter(
        (row) =>
          normalizeBenchmarkText(row.expectedTranscript) ===
          normalizeBenchmarkText(row.transcript),
      ).length,
      rows.length,
    ),
    averageWer: average(
      rows.map((row) => wordErrorRate(row.expectedTranscript, row.transcript)),
    ),
    intentAccuracy: ratio(
      rows.filter((row) => row.expectedPageId === row.detectedPageId).length,
      rows.length,
    ),
    unknownFalsePositiveRate: ratio(
      unknownRows.filter((row) => row.detectedPageId !== null).length,
      unknownRows.length,
    ),
    medianLatencyMs: median(latencies),
    p95LatencyMs: percentile(latencies, 0.95),
  };
}

function tokenize(text: string): string[] {
  const normalized = normalizeBenchmarkText(text);
  return normalized ? normalized.split(" ") : [];
}

function editDistance(left: readonly string[], right: readonly string[]): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const index = Math.max(0, Math.ceil(values.length * fraction) - 1);
  return values[index];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}
