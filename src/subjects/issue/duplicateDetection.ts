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

const MAX_DUPLICATE_SEARCH_TERMS = 8;
const MAX_DUPLICATE_SEARCH_PHRASES = 4;
const MAX_DUPLICATE_TITLE_TOKENS = 3;
const MAX_DUPLICATE_CONTENT_TOKENS = 3;

const DUPLICATE_PRIMARY_SECTION_HINTS = [
  "description",
  "summary",
  "question",
  "problem",
  "issue",
  "details",
  "现象",
  "描述",
  "问题",
  "反馈",
  "需求",
  "建议",
  "steps",
  "reproduce",
  "repro",
  "复现",
  "重现",
  "步骤",
  "error",
  "errors",
  "exception",
  "crash",
  "stack",
  "trace",
  "log",
  "logs",
  "报错",
  "错误",
  "异常",
  "日志",
  "堆栈"
];

const DUPLICATE_SECONDARY_SECTION_HINTS = [
  "expected",
  "behavior",
  "actual",
  "result",
  "预期",
  "结果"
];

const DUPLICATE_IGNORED_SECTION_HINTS = [
  "environment",
  "version",
  "system",
  "platform",
  "java",
  "os",
  "系统环境",
  "运行环境",
  "环境",
  "版本",
  "平台"
];

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

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stripDuplicateSearchTitlePrefix(value: string): string {
  return value
    .replace(/^(?:\s*(?:\[[^\]]+\]|【[^】]+】|\([^)]+\)|（[^）]+）)\s*)+/u, "")
    .trim();
}

function normalizeDuplicateSearchTerm(value: string): string {
  return normalizeText(value).slice(0, 80).trim();
}

function extractDuplicateSearchLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, "").trim())
    .map(normalizeDuplicateSearchTerm)
    .filter((line) => line.length >= 4);
}

function getDuplicateSectionPriority(key: string): number {
  if (key === "__root__") {
    return 1;
  }

  if (DUPLICATE_IGNORED_SECTION_HINTS.some((hint) => key.includes(hint))) {
    return -1;
  }

  if (DUPLICATE_PRIMARY_SECTION_HINTS.some((hint) => key.includes(hint))) {
    return 3;
  }

  if (DUPLICATE_SECONDARY_SECTION_HINTS.some((hint) => key.includes(hint))) {
    return 2;
  }

  return 1;
}

function collectDuplicateSearchPhrases(parsed: ParsedIssue): string[] {
  const prioritizedSections = Object.entries(parsed.sections)
    .map(([key, value]) => ({
      key,
      value,
      priority: getDuplicateSectionPriority(key)
    }))
    .filter((entry) => entry.priority >= 0 && entry.value.trim())
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key));

  const phrases: string[] = [];
  for (const entry of prioritizedSections) {
    phrases.push(...extractDuplicateSearchLines(entry.value));
    if (phrases.length >= MAX_DUPLICATE_SEARCH_PHRASES * 2) {
      break;
    }
  }

  return unique(phrases).slice(0, MAX_DUPLICATE_SEARCH_PHRASES);
}

function prioritizeDuplicateSearchTokens(values: string[], limit: number): string[] {
  return unique(values
    .map(normalizeDuplicateSearchTerm)
    .flatMap(tokenize)
    .filter((token) => token.length >= 2 && token.length <= 24))
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, limit);
}

export function buildDuplicateSearchTerms(issue: IssueContext, parsed: ParsedIssue): string[] {
  const title = stripDuplicateSearchTitlePrefix(issue.title);
  const normalizedTitle = normalizeDuplicateSearchTerm(title);
  const sectionPhrases = collectDuplicateSearchPhrases(parsed);
  const titleTokens = prioritizeDuplicateSearchTokens([title], MAX_DUPLICATE_TITLE_TOKENS);
  const contentTokens = prioritizeDuplicateSearchTokens(sectionPhrases, MAX_DUPLICATE_CONTENT_TOKENS);

  return unique([
    normalizedTitle,
    ...sectionPhrases,
    ...titleTokens,
    ...contentTokens
  ]).slice(0, MAX_DUPLICATE_SEARCH_TERMS);
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

  const terms = buildDuplicateSearchTerms(params.issue, params.parsed);
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
