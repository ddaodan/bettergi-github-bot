import * as core from "@actions/core";

import type { CommentMode, IssueContext, ParsedIssue, RepoBotConfig } from "../../core/types.js";
import { renderAiHelpComment } from "../../i18n/comments.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";

export async function generateIssueAiHelp(params: {
  issue: IssueContext;
  parsed: ParsedIssue;
  config: RepoBotConfig["issues"]["aiHelp"];
  commentMode: CommentMode;
  provider?: OpenAiCompatibleProvider;
}): Promise<string | undefined> {
  if (!params.config.enabled) {
    return undefined;
  }

  if (!params.provider) {
    core.info("Skip AI help because provider is unavailable.");
    return undefined;
  }

  const hasTriggerLabel = params.config.triggerLabels.length === 0
    || params.config.triggerLabels.some((label) => params.issue.labels.includes(label));

  if (!hasTriggerLabel) {
    core.info("Skip AI help because trigger labels do not match.");
    return undefined;
  }

  const help = await params.provider.generateHelp(params.issue, params.parsed.sections);
  return renderAiHelpComment({
    mode: params.commentMode,
    help
  });
}
