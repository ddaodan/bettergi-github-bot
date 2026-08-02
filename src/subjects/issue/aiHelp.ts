import * as core from "@actions/core";

import { sanitizeAiHelpResultForComment } from "../../core/aiSafety.js";
import type {
  CommentMode,
  IssueCodeContextConfig,
  IssueContext,
  ParsedIssue,
  RepoBotConfig,
  RepositoryCodeContext,
  RepositoryAiContext,
  SimilarIssueCandidate
} from "../../core/types.js";
import { renderAiHelpComment } from "../../i18n/comments.js";
import type { GitHubGateway } from "../../github/gateway.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";
import { enrichIssueWithTextAttachments } from "./attachments.js";
import { collectRepositoryCodeContext } from "./codeContext.js";

export async function generateIssueAiHelp(params: {
  workspace: string;
  issue: IssueContext;
  parsed: ParsedIssue;
  config: RepoBotConfig["issues"]["aiHelp"];
  codeContextConfig: IssueCodeContextConfig;
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
    let codeContext: RepositoryCodeContext | undefined;
    if (params.codeContextConfig.includeInAiHelp) {
      codeContext = await collectRepositoryCodeContext({
        workspace: params.workspace,
        issue: params.issue,
        parsed,
        repositoryContext: params.repositoryContext,
        config: params.codeContextConfig,
        gateway: params.gateway
      });
    }
    const help = await params.provider.generateHelp(
      params.issue,
      parsed,
      params.repositoryContext,
      params.commentMode,
      codeContext
    );
    const sanitizedHelp = sanitizeAiHelpResultForComment({
      help,
      mode: params.commentMode,
      blockedTexts: [
        params.issue.body,
        params.issue.parentIssue?.bodyExcerpt ?? "",
        JSON.stringify(params.repositoryContext),
        ...(codeContext ? [JSON.stringify(codeContext)] : []),
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
