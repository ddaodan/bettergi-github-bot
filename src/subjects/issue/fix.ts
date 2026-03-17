import * as core from "@actions/core";

import type { CommentMode, IssueContext, RepoBotConfig } from "../../core/types.js";
import { upsertAnchoredComment } from "../../github/comments.js";
import type { GitHubGateway } from "../../github/gateway.js";
import { renderFixStatusComment, renderFixSuggestionComment } from "../../i18n/comments.js";
import { detectCommentMode } from "../../i18n/language.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";
import { collectRepositoryCodeContext } from "./codeContext.js";
import { resolveRepositoryAiContext } from "./projectContext.js";
import { validateIssue } from "./validation.js";

export type IssueCommandExecutionOutcome = "success" | "rejected";

function getFixCommentMode(issue: IssueContext, config: RepoBotConfig): CommentMode {
  return detectCommentMode(`${issue.title}\n${issue.body}`, config.runtime);
}

async function updateFixStatusComment(params: {
  issueNumber: number;
  gateway: GitHubGateway;
  config: RepoBotConfig;
  mode: CommentMode;
  titleZh: string;
  titleEn: string;
  messageZh: string;
  messageEn: string;
}): Promise<void> {
  await upsertAnchoredComment({
    gateway: params.gateway,
    issueNumber: params.issueNumber,
    anchor: params.config.issues.commands.fix.commentAnchor,
    body: renderFixStatusComment({
      mode: params.mode,
      titleZh: params.titleZh,
      titleEn: params.titleEn,
      messageZh: params.messageZh,
      messageEn: params.messageEn
    })
  });
}

export async function runIssueFixCommand(params: {
  workspace: string;
  issue: IssueContext;
  config: RepoBotConfig;
  gateway: GitHubGateway;
  provider?: OpenAiCompatibleProvider;
}): Promise<IssueCommandExecutionOutcome> {
  const commentMode = getFixCommentMode(params.issue, params.config);

  if (params.issue.state !== "open") {
    await updateFixStatusComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      config: params.config,
      mode: commentMode,
      titleZh: "AI 修复建议",
      titleEn: "AI Fix Suggestion",
      messageZh: "当前 Issue 已关闭，暂不生成修复建议或补丁草案。",
      messageEn: "This issue is already closed, so no fix suggestion or patch draft will be generated."
    });
    return "rejected";
  }

  const validation = validateIssue({
    title: params.issue.title,
    body: params.issue.body,
    config: params.config.issues.validation,
    commentMode
  });

  if (!validation.valid) {
    await updateFixStatusComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      config: params.config,
      mode: commentMode,
      titleZh: "AI 修复建议",
      titleEn: "AI Fix Suggestion",
      messageZh: "当前 Issue 还未通过模板检查，请先补全模板后再执行 `@bot /fix`。",
      messageEn: "This issue has not passed template validation yet. Complete the template first, then run `@bot /fix` again."
    });
    return "rejected";
  }

  if (params.issue.labels.includes(params.config.issues.validation.duplicateDetection.duplicateLabel)) {
    await updateFixStatusComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      config: params.config,
      mode: commentMode,
      titleZh: "AI 修复建议",
      titleEn: "AI Fix Suggestion",
      messageZh: "当前 Issue 已标记为重复，不再生成修复建议。",
      messageEn: "This issue is already marked as duplicate, so no fix suggestion will be generated."
    });
    return "rejected";
  }

  if (!params.provider) {
    await updateFixStatusComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      config: params.config,
      mode: commentMode,
      titleZh: "AI 修复建议",
      titleEn: "AI Fix Suggestion",
      messageZh: "当前仓库未配置可用的 AI Provider，暂时无法生成修复建议。",
      messageEn: "No usable AI provider is configured for this repository, so a fix suggestion cannot be generated right now."
    });
    return "rejected";
  }

  const repositoryContext = await resolveRepositoryAiContext({
    issue: params.issue,
    gateway: params.gateway,
    config: params.config.issues.aiHelp.projectContext,
    templateKey: validation.template?.key ?? validation.parsed.marker
  });
  const codeContext = await collectRepositoryCodeContext({
    workspace: params.workspace,
    issue: params.issue,
    parsed: validation.parsed,
    repositoryContext
  });

  try {
    const suggestion = await params.provider.generateFixSuggestion(
      params.issue,
      validation.parsed,
      repositoryContext,
      codeContext,
      commentMode
    );

    await upsertAnchoredComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      anchor: params.config.issues.commands.fix.commentAnchor,
      body: renderFixSuggestionComment({
        mode: commentMode,
        suggestion
      })
    });

    return "success";
  } catch (error) {
    core.warning(`Skip /fix because provider request failed: ${String(error)}`);
    await updateFixStatusComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      config: params.config,
      mode: commentMode,
      titleZh: "AI 修复建议",
      titleEn: "AI Fix Suggestion",
      messageZh: "本次未能生成修复建议，请稍后重试，或补充更具体的日志、复现步骤和相关代码线索。",
      messageEn: "A fix suggestion could not be generated this time. Please try again later, or provide more specific logs, repro steps, and code clues."
    });
    return "rejected";
  }
}
