import * as core from "@actions/core";

import { sanitizeAiHelpResultForComment } from "../../core/aiSafety.js";
import type {
  CommentMode,
  IssueContext,
  ParsedIssue,
  RepoBotConfig,
  RepositoryAiContext,
  SimilarIssueCandidate
} from "../../core/types.js";
import { renderAiHelpComment } from "../../i18n/comments.js";
import type { GitHubGateway } from "../../github/gateway.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";
import { enrichIssueWithTextAttachments } from "./attachments.js";

export async function generateIssueAiHelp(params: {
  issue: IssueContext;
  parsed: ParsedIssue;
  config: RepoBotConfig["issues"]["aiHelp"];
  commentMode: CommentMode;
  repositoryContext: RepositoryAiContext;
  relatedIssues?: SimilarIssueCandidate[];
  gateway: GitHubGateway;
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

  try {
    const parsed = await enrichIssueWithTextAttachments({
      issueNumber: params.issue.number,
      parsed: params.parsed,
      gateway: params.gateway
    });
    const help = await params.provider.generateHelp(
      params.issue,
      parsed,
      params.repositoryContext,
      params.commentMode
    );
    const sanitizedHelp = sanitizeAiHelpResultForComment({
      help,
      mode: params.commentMode,
      blockedTexts: [
        params.issue.body,
        JSON.stringify(params.repositoryContext),
        ...parsed.textAttachments.map((attachment) => attachment.content)
      ]
    });
    return renderAiHelpComment({
      mode: params.commentMode,
      templateKey: params.repositoryContext.templateKey,
      help: sanitizedHelp,
      relatedIssues: params.relatedIssues
    });
  } catch (error) {
    core.warning(`Skip AI help because provider request failed: ${String(error)}`);
    return undefined;
  }
}
