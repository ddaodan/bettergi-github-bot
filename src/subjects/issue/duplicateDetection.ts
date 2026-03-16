import * as core from "@actions/core";

import type {
  DuplicateCandidate,
  DuplicateDecision,
  DuplicateDetectionConfig,
  DuplicateReviewResult,
  IssueContext,
  ParsedIssue,
  SimilarIssueCandidate
} from "../../core/types.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";
import { normalizeText, parseIssueBody, tokenize } from "./parser.js";

function jaccardSimilarity(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function cosineBagSimilarity(left: string[], right: string[]): number {
  const counts = new Map<string, [number, number]>();
  for (const token of left) {
    const entry = counts.get(token) ?? [0, 0];
    entry[0] += 1;
    counts.set(token, entry);
  }
  for (const token of right) {
    const entry = counts.get(token) ?? [0, 0];
    entry[1] += 1;
    counts.set(token, entry);
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [leftCount, rightCount] of counts.values()) {
    dot += leftCount * rightCount;
    leftNorm += leftCount * leftCount;
    rightNorm += rightCount * rightCount;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function buildIssueSignature(title: string, parsed: ParsedIssue): string {
  const sectionSummary = Object.entries(parsed.sections)
    .filter(([key]) => key !== "__root__")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${normalizeText(value).slice(0, 120)}`)
    .join("|");

  return normalizeText(`${title}|${sectionSummary}`);
}

function rankCandidate(issue: IssueContext, parsed: ParsedIssue, candidate: DuplicateCandidate): number {
  const currentSignature = buildIssueSignature(issue.title, parsed);
  const candidateSignature = buildIssueSignature(candidate.title, parseIssueBody(candidate.body));

  if (currentSignature && currentSignature === candidateSignature) {
    return 1;
  }

  const titleJaccard = jaccardSimilarity(tokenize(issue.title), tokenize(candidate.title));
  const bodyCosine = cosineBagSimilarity(tokenize(issue.body), tokenize(candidate.body));
  const signatureJaccard = jaccardSimilarity(tokenize(currentSignature), tokenize(candidateSignature));

  return (titleJaccard * 0.4) + (bodyCosine * 0.35) + (signatureJaccard * 0.25);
}

export function chooseCanonicalIssue(candidates: DuplicateCandidate[]): DuplicateCandidate | undefined {
  return [...candidates].sort((left, right) => {
    if (left.state !== right.state) {
      return left.state === "open" ? -1 : 1;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt);
    }
    return left.number - right.number;
  })[0];
}

function buildSimilarIssueSuggestions(
  ranked: SimilarIssueCandidate[],
  config: DuplicateDetectionConfig
): SimilarIssueCandidate[] {
  if (!config.similarityComment.enabled) {
    return [];
  }

  return ranked
    .filter((entry) => entry.score >= config.similarityComment.minScore)
    .slice(0, config.similarityComment.maxCandidates);
}

export async function detectDuplicate(params: {
  issue: IssueContext;
  parsed: ParsedIssue;
  config: DuplicateDetectionConfig;
  provider?: OpenAiCompatibleProvider;
  searchIssues: (terms: string[], limit: number) => Promise<DuplicateCandidate[]>;
  addDuplicateLabel: (labels: string[]) => Promise<void>;
  closeIssue: () => Promise<void>;
}): Promise<DuplicateDecision> {
  if (!params.config.enabled) {
    return { executed: false, skippedReason: "duplicate detection disabled" };
  }

  if (params.issue.labels.some((label) => params.config.bypassLabels.includes(label))) {
    return { executed: true, skippedReason: "bypass label matched" };
  }

  const terms = [...new Set(tokenize(params.issue.title).slice(0, 6))];
  const searchResults = await params.searchIssues(terms, params.config.searchResultLimit);

  const ranked = searchResults
    .map((candidate) => ({
      candidate,
      score: rankCandidate(params.issue, params.parsed, candidate)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, params.config.candidateLimit);

  const similarIssues = buildSimilarIssueSuggestions(ranked, params.config);

  const exactMatch = ranked.find((entry) => entry.score >= params.config.thresholds.exact);
  if (exactMatch) {
    const canonical = chooseCanonicalIssue([exactMatch.candidate]);
    if (!canonical) {
      return { executed: true, skippedReason: "exact match missing canonical candidate" };
    }
    await params.addDuplicateLabel([params.config.duplicateLabel]);
    await params.closeIssue();
    return {
      executed: true,
      duplicateOf: canonical,
      confidence: exactMatch.score,
      similarIssues: []
    };
  }

  const highConfidence = ranked.filter((entry) => entry.score >= params.config.thresholds.highConfidence);
  if (highConfidence.length > 0) {
    const canonical = chooseCanonicalIssue(highConfidence.map((entry) => entry.candidate));
    if (!canonical) {
      return { executed: true, skippedReason: "high confidence match missing canonical candidate" };
    }
    const score = highConfidence.find((entry) => entry.candidate.number === canonical.number)?.score ?? highConfidence[0]!.score;
    await params.addDuplicateLabel([params.config.duplicateLabel]);
    await params.closeIssue();
    return {
      executed: true,
      duplicateOf: canonical,
      confidence: score,
      similarIssues: []
    };
  }

  if (!params.provider) {
    return {
      executed: true,
      skippedReason: "provider unavailable for duplicate AI review",
      similarIssues
    };
  }

  const reviewCandidates = ranked
    .filter((entry) => entry.score >= params.config.thresholds.reviewMin)
    .slice(0, params.config.aiReviewMaxCandidates);

  let bestReview: { candidate: DuplicateCandidate; review: DuplicateReviewResult } | undefined;
  for (const entry of reviewCandidates) {
    try {
      const review = await params.provider.reviewDuplicate(params.issue, entry.candidate);
      if (review.duplicate && (!bestReview || review.confidence > bestReview.review.confidence)) {
        bestReview = {
          candidate: entry.candidate,
          review
        };
      }
    } catch (error) {
      core.warning(`Duplicate AI review failed for #${entry.candidate.number}: ${String(error)}`);
    }
  }

  if (!bestReview) {
    return {
      executed: true,
      skippedReason: "no duplicate candidate confirmed by AI",
      similarIssues
    };
  }

  await params.addDuplicateLabel([params.config.duplicateLabel]);
  await params.closeIssue();

  return {
    executed: true,
    duplicateOf: bestReview.candidate,
    confidence: bestReview.review.confidence,
    aiReviewed: true,
    similarIssues: []
  };
}
