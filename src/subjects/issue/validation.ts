import * as core from "@actions/core";

import { DEFAULT_PLACEHOLDER_HINTS } from "../../core/constants.js";
import type { CommentMode, ValidationConfig, ValidationOutcome } from "../../core/types.js";
import { renderValidationComment } from "../../i18n/comments.js";
import { detectTemplate, getSectionContent, matchTemplate, normalizeText, parseIssueBody } from "./parser.js";

function isPlaceholder(content: string, hints: string[]): boolean {
  const normalized = normalizeText(content);
  if (!normalized) {
    return true;
  }

  return hints.some((hint) => {
    const needle = normalizeText(hint);
    if (!needle) {
      return false;
    }

    return normalized === needle
      || normalized.startsWith(`${needle} `)
      || normalized.endsWith(` ${needle}`)
      || normalized.includes(` ${needle} `);
  });
}

export function validateIssue(params: {
  title?: string;
  body: string;
  config: ValidationConfig;
  commentMode: CommentMode;
  dryRun?: boolean;
  transferred?: boolean;
}): ValidationOutcome {
  if (!params.config.enabled) {
    return {
      executed: false,
      valid: true,
      templateMatched: false,
      parsed: parseIssueBody(params.body),
      missingSections: [],
      desiredLabels: [],
      invalidLabels: []
    };
  }

  const parsed = parseIssueBody(params.body);
  const detected = detectTemplate(parsed, params.config.templates, params.title);
  const template = matchTemplate(parsed, params.config.templates, params.config.fallbackTemplateKey, params.title);
  const templateMatched = Boolean(detected);
  const willAutoClose = params.config.autoClose.enabled && !templateMatched && !params.transferred;

  if (!detected) {
    core.info(
      `Issue did not match any template (title prefix/section headings without a form signature are not accepted). Fallback template: ${template?.key ?? "none"}.`
    );
    return {
      executed: true,
      valid: false,
      templateMatched,
      parsed,
      missingSections: [],
      desiredLabels: [],
      invalidLabels: template?.labels.whenInvalid ?? [],
      commentBody: renderValidationComment({
        mode: params.commentMode,
        valid: false,
        missingSections: ["未找到可用模板 / No matching template found"],
        closedForInvalidTemplate: willAutoClose,
        transferred: params.transferred,
        dryRun: params.dryRun
      })
    };
  }

  const effectiveSections = params.transferred
    ? detected.requiredSections.filter((rule) => !rule.transferExempt)
    : detected.requiredSections;
  const missingSections = effectiveSections
    .filter((rule) => {
      const content = getSectionContent(parsed, rule);
      const hints = [...DEFAULT_PLACEHOLDER_HINTS, ...(rule.placeholderHints ?? [])];
      return isPlaceholder(content, hints);
    })
    .map((rule) => ({
      id: rule.id,
      aliases: rule.aliases
    }));

  const valid = missingSections.length === 0;
  return {
    executed: true,
    valid,
    template: detected,
    templateMatched,
    parsed,
    missingSections,
    desiredLabels: valid ? detected.labels.whenValid : [],
    invalidLabels: valid ? [] : detected.labels.whenInvalid,
    commentBody: valid
      ? undefined
      : renderValidationComment({
        mode: params.commentMode,
        valid: false,
        templateKey: detected.key,
        missingSections: missingSections.map((item) => item.aliases[0] ?? item.id),
        closedForInvalidTemplate: willAutoClose,
        transferred: params.transferred,
        dryRun: params.dryRun
      })
  };
}
