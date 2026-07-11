import * as core from "@actions/core";

import { containsSensitiveText, sanitizeTextForAiContext } from "../../core/aiSafety.js";
import type {
  IssueContext,
  IssueTitleGenerationConfig,
  ParsedIssue,
  ValidationOutcome
} from "../../core/types.js";
import type { GitHubGateway } from "../../github/gateway.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";
import { getSectionContent } from "./parser.js";

const PREFERRED_SECTION_PATTERN = /(description|summary|problem|question|request|suggestion|content|描述|问题|建议|需求|内容|现象)/i;
const LOW_SIGNAL_SECTION_PATTERN = /(checklist|environment|version|steps|expected|logs?|attachments?|提交确认|系统环境|版本|复现|期望|日志|附件)/i;

function normalizeComparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\[\]【】()（）<>《》"'`*_:#：\s-]+/g, "")
    .trim();
}

function findConfiguredPrefix(title: string, prefixes: string[]): string {
  const normalizedTitle = title.trimStart().toLowerCase();
  return [...prefixes]
    .sort((left, right) => right.length - left.length)
    .find((prefix) => normalizedTitle.startsWith(prefix.trim().toLowerCase())) ?? "";
}

export function stripConfiguredTitlePrefix(title: string, prefixes: string[]): string {
  const prefix = findConfiguredPrefix(title, prefixes);
  return prefix ? title.trimStart().slice(prefix.length).trim() : title.trim();
}

export function isPlaceholderIssueTitle(params: {
  title: string;
  prefixes: string[];
  placeholderTitles: string[];
}): boolean {
  const coreTitle = stripConfiguredTitlePrefix(params.title, params.prefixes);
  const normalized = normalizeComparable(coreTitle);
  if (!normalized) {
    return true;
  }

  return params.placeholderTitles.some((placeholder) => normalizeComparable(placeholder) === normalized);
}

function cleanEvidence(value: string): string[] {
  const cleaned = value
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*[-*+]\s*\[[ xX]\]\s*/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/[\t ]+/g, " ");

  return cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const normalized = normalizeComparable(line);
      return normalized.length >= 3
        && !["noresponse", "none", "n/a", "无", "暂无", "没有"].includes(normalized)
        && !/^\[?\d{1,2}:\d{2}:\d{2}/.test(line)
        && !/^at\s+[A-Za-z0-9_.<>]+\(/.test(line)
        && !containsSensitiveText(line);
    });
}

function collectTitleEvidence(validation: ValidationOutcome): string {
  const template = validation.template;
  if (template) {
    const preferredRules = [...template.requiredSections]
      .sort((left, right) => {
        const leftPreferred = PREFERRED_SECTION_PATTERN.test(`${left.id} ${left.aliases.join(" ")}`) ? 1 : 0;
        const rightPreferred = PREFERRED_SECTION_PATTERN.test(`${right.id} ${right.aliases.join(" ")}`) ? 1 : 0;
        return rightPreferred - leftPreferred;
      });

    for (const rule of preferredRules) {
      if (!PREFERRED_SECTION_PATTERN.test(`${rule.id} ${rule.aliases.join(" ")}`)) {
        continue;
      }
      const content = getSectionContent(validation.parsed, rule);
      if (cleanEvidence(content).length > 0) {
        return content;
      }
    }
  }

  const section = Object.entries(validation.parsed.sections)
    .find(([heading, content]) => heading !== "__root__"
      && !LOW_SIGNAL_SECTION_PATTERN.test(heading)
      && cleanEvidence(content).length > 0);
  if (section) {
    return section[1];
  }

  return Object.values(validation.parsed.sections).join("\n");
}

function takeUnicode(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) {
    return value;
  }
  return `${characters.slice(0, Math.max(1, maxLength - 1)).join("").trimEnd()}…`;
}

function normalizeGeneratedCore(value: string, prefixes: string[]): string {
  const firstLine = value.split(/\r?\n/).find((line) => line.trim()) ?? "";
  return stripConfiguredTitlePrefix(firstLine, prefixes)
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function composeTitle(params: {
  currentTitle: string;
  generatedCore: string;
  prefixes: string[];
  maxLength: number;
}): string {
  const existingPrefix = findConfiguredPrefix(params.currentTitle, params.prefixes);
  const prefix = existingPrefix || params.prefixes[0]?.trim() || "";
  const availableLength = Math.max(1, params.maxLength - Array.from(prefix).length - (prefix ? 1 : 0));
  const core = takeUnicode(normalizeGeneratedCore(params.generatedCore, params.prefixes), availableLength);
  if (!normalizeComparable(core)) {
    return "";
  }
  return prefix ? `${prefix} ${core}`.trim() : core;
}

function titleUnits(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const units = new Set<string>();
  for (const word of normalized.match(/[a-z0-9]{3,}/g) ?? []) {
    units.add(word);
  }
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    const chars = Array.from(sequence);
    for (let index = 0; index < chars.length - 1; index += 1) {
      units.add(`${chars[index]}${chars[index + 1]}`);
    }
  }
  return [...units];
}

export function shouldReviewTitleMismatch(params: {
  title: string;
  prefixes: string[];
  evidence: string;
}): boolean {
  const coreTitle = stripConfiguredTitlePrefix(params.title, params.prefixes);
  const units = titleUnits(coreTitle);
  if (units.length < 2 || normalizeComparable(params.evidence).length < 12) {
    return false;
  }

  const evidenceUnits = new Set(titleUnits(params.evidence));
  const overlap = units.filter((unit) => evidenceUnits.has(unit)).length / units.length;
  return overlap < 0.12;
}

export async function maybeUpdateIssueTitle(params: {
  issue: IssueContext;
  validation: ValidationOutcome;
  config: IssueTitleGenerationConfig;
  gateway: GitHubGateway;
  provider?: OpenAiCompatibleProvider;
}): Promise<boolean> {
  if (!params.config.enabled || !params.validation.valid || !params.validation.template) {
    return false;
  }

  const prefixes = params.validation.template.detect.titlePrefixes;
  const placeholder = isPlaceholderIssueTitle({
    title: params.issue.title,
    prefixes,
    placeholderTitles: params.config.placeholderTitles
  });
  const evidence = collectTitleEvidence(params.validation);
  const mismatchReview = !placeholder
    && params.config.detectMismatch
    && Boolean(params.provider)
    && shouldReviewTitleMismatch({
      title: params.issue.title,
      prefixes,
      evidence
    });
  if (!placeholder && !mismatchReview) {
    return false;
  }

  let generatedCore = "";
  if (params.provider) {
    try {
      const suggestion = await params.provider.suggestIssueTitle(
        params.issue,
        params.validation.parsed,
        params.validation.template.key
      );
      if (placeholder || (suggestion.shouldReplace && suggestion.confidence >= params.config.mismatchConfidence)) {
        const sanitizedTitle = sanitizeTextForAiContext(suggestion.title);
        if (!sanitizedTitle.includes("[REDACTED")) {
          generatedCore = sanitizedTitle;
        }
      } else if (mismatchReview) {
        core.info(`Keep issue #${params.issue.number} title after AI mismatch review (${suggestion.confidence.toFixed(2)}).`);
        return false;
      }
    } catch (error) {
      core.warning(`AI issue title suggestion failed. Keep the existing title: ${String(error)}`);
    }
  }

  if (!generatedCore) {
    return false;
  }

  const title = composeTitle({
    currentTitle: params.issue.title,
    generatedCore,
    prefixes,
    maxLength: params.config.maxLength
  });
  if (!title || normalizeComparable(title) === normalizeComparable(params.issue.title)) {
    return false;
  }

  await params.gateway.updateIssueTitle(params.issue.number, title);
  params.issue.title = title;
  core.info(`Updated issue #${params.issue.number} title to "${title}".`);
  return true;
}
