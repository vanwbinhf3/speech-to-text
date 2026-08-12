import { pages } from "../config/pages";
import type { NavigationIntent } from "../types/navigation";

export const INTENT_CONFIDENCE_THRESHOLD = 0.65;
export const INTENT_AMBIGUITY_MARGIN = 0.08;

const NAVIGATION_CUES = [
  "open",
  "show",
  "go",
  "navigate",
  "take me",
  "bring me",
  "want to see",
  "want to check",
  "check",
  "view",
];

interface Candidate {
  pageId: string;
  pageName: string;
  matchedPhrase: string;
  confidence: number;
  aliasTokenCount: number;
  exact: boolean;
}

export function normalizeTranscript(transcript: string): string {
  return transcript
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function similarity(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 1;
  return 1 - levenshteinDistance(left, right) / longest;
}

function containsPhrase(transcript: string, phrase: string): boolean {
  return ` ${transcript} `.includes(` ${phrase} `);
}

function bestFuzzySimilarity(transcript: string, alias: string): number {
  const transcriptTokens = transcript.split(" ");
  const aliasTokenCount = alias.split(" ").length;
  let best = similarity(transcript, alias);

  for (const length of [aliasTokenCount - 1, aliasTokenCount, aliasTokenCount + 1]) {
    if (length < 1 || length > transcriptTokens.length) continue;
    for (let index = 0; index <= transcriptTokens.length - length; index += 1) {
      const phrase = transcriptTokens.slice(index, index + length).join(" ");
      best = Math.max(best, similarity(phrase, alias));
    }
  }

  return best;
}

function candidateForAlias(
  transcript: string,
  pageId: string,
  pageName: string,
  alias: string,
  hasNavigationCue: boolean,
): Candidate {
  const transcriptTokenCount = transcript.split(" ").length;
  const aliasTokenCount = alias.split(" ").length;
  const exact = containsPhrase(transcript, alias);
  const directCommand = transcriptTokenCount <= aliasTokenCount + 2;
  let confidence: number;

  if (exact) {
    confidence = hasNavigationCue || directCommand
      ? 0.84 + Math.min(0.12, aliasTokenCount * 0.04) + (hasNavigationCue ? 0.05 : 0)
      : 0.52;
  } else {
    const fuzzySimilarity = bestFuzzySimilarity(transcript, alias);
    confidence =
      fuzzySimilarity * 0.72 +
      (hasNavigationCue ? 0.16 : 0) +
      (directCommand ? 0.08 : 0);
  }

  return {
    pageId,
    pageName,
    matchedPhrase: alias,
    confidence: Math.min(0.99, confidence),
    aliasTokenCount,
    exact,
  };
}

export function detectNavigationIntent(transcript: string): NavigationIntent {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) {
    return { pageId: null, pageName: null, confidence: 0 };
  }

  const hasNavigationCue = NAVIGATION_CUES.some((cue) =>
    containsPhrase(normalized, cue),
  );
  const candidates = pages
    .flatMap((page) =>
      page.aliases.map((alias) =>
        candidateForAlias(
          normalized,
          page.id,
          page.name,
          normalizeTranscript(alias),
          hasNavigationCue,
        ),
      ),
    )
    .sort((left, right) =>
      right.confidence - left.confidence ||
      Number(right.exact) - Number(left.exact) ||
      right.aliasTokenCount - left.aliasTokenCount,
    );

  const winner = candidates[0];
  const runnerUp = candidates.find((candidate) => candidate.pageId !== winner.pageId);
  const isAmbiguous =
    runnerUp !== undefined &&
    winner.aliasTokenCount <= runnerUp.aliasTokenCount &&
    winner.confidence - runnerUp.confidence < INTENT_AMBIGUITY_MARGIN;

  if (winner.confidence < INTENT_CONFIDENCE_THRESHOLD || isAmbiguous) {
    return {
      pageId: null,
      pageName: null,
      confidence: Number(winner.confidence.toFixed(2)),
      matchedPhrase: winner.matchedPhrase,
    };
  }

  return {
    pageId: winner.pageId,
    pageName: winner.pageName,
    confidence: Number(winner.confidence.toFixed(2)),
    matchedPhrase: winner.matchedPhrase,
  };
}
