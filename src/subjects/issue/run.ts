import * as core from "@actions/core";

import type { CommentMode, IssueContext, RepoBotConfig } from "../../core/types.js";
import { syncAnchoredComment, upsertAnchoredComment } from "../../github/comments.js";
import type { GitHubGateway } from "../../github/gateway.js";
import { detectCommentMode } from "../../i18n/language.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";
import { generateIssueAiHelp } from "./aiHelp.js";
import { detectDuplicate } from "./duplicateDetection.js";
import { computeManagedLabels } from "./labeling.js";
import { resolveRepositoryAiContext } from "./projectContext.js";
import { validateIssue } from "./validation.js";

function shouldRunValidation(action: string): boolean {
  return ["opened", "edited", "reopened"].includes(action);
}

function shouldRunLabeling(action: string): boolean {
  return ["opened", "edited", "reopened", "labeled"].includes(action);
}

function shouldRunAi(action: string): boolean {
  return ["opened", "edited", "reopened", "labeled"].includes(action);
}

export async function runIssueWorkflow(params: {
  issue: IssueContext;
  config: RepoBotConfig;
  gateway: GitHubGateway;
  provider?: OpenAiCompatibleProvider;
}): Promise<void> {
  const effectiveLabels = new Set(params.issue.labels);
  const commentMode: CommentMode = detectCommentMode(`${params.issue.title}\n${params.issue.body}`, params.config.runtime);
  const validation = validateIssue({
    body: params.issue.body,
    config: params.config.issues.validation,
    commentMode
  });

  if (shouldRunValidation(params.issue.action)) {
    await syncAnchoredComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      anchor: params.config.issues.validation.commentAnchor,
      body: validation.commentBody
    });
  }

  if (shouldRunValidation(params.issue.action) && validation.executed && !validation.valid) {
    core.info("Issue failed template validation. Skip duplicate detection and AI help.");
  }

  let duplicated = false;
  if (shouldRunValidation(params.issue.action) && validation.valid) {
    const duplicateDecision = await detectDuplicate({
      issue: params.issue,
      parsed: validation.parsed,
      config: params.config.issues.validation.duplicateDetection,
      commentMode,
      provider: params.provider,
      searchIssues: async (terms, limit) => params.gateway.searchIssues({
        owner: params.issue.owner,
        repo: params.issue.repo,
        currentIssueNumber: params.issue.number,
        terms,
        limit
      }),
      addDuplicateComment: async (body) => {
        await params.gateway.createComment(params.issue.number, body);
      },
      addDuplicateLabel: async (labels) => {
        if (params.config.issues.labeling.autoCreateMissing) {
          await params.gateway.ensureLabels(params.config.issues.labeling.definitions, labels);
        }
        await params.gateway.addLabels(params.issue.number, labels);
        for (const label of labels) {
          effectiveLabels.add(label);
        }
      },
      closeIssue: async () => {
        await params.gateway.closeIssue(params.issue.number);
      }
    });

    duplicated = Boolean(duplicateDecision.duplicateOf);
  }

  if (shouldRunLabeling(params.issue.action) && params.config.issues.labeling.enabled && !duplicated) {
    const preservedLabels = [...effectiveLabels].filter((label) => params.config.issues.aiHelp.triggerLabels.includes(label));
    const managedLabels = computeManagedLabels({
      issue: params.issue,
      config: params.config.issues.labeling,
      validation,
      preservedLabels
    });

    if (params.config.issues.labeling.autoCreateMissing) {
      await params.gateway.ensureLabels(params.config.issues.labeling.definitions, managedLabels.labelsToAdd);
    }

    if (managedLabels.labelsToAdd.length > 0) {
      await params.gateway.addLabels(params.issue.number, managedLabels.labelsToAdd);
      for (const label of managedLabels.labelsToAdd) {
        effectiveLabels.add(label);
      }
    }
    for (const label of managedLabels.labelsToRemove) {
      await params.gateway.removeLabel(params.issue.number, label);
      effectiveLabels.delete(label);
    }
  }

  if (duplicated || !shouldRunAi(params.issue.action) || !validation.valid) {
    return;
  }

  const repositoryContext = await resolveRepositoryAiContext({
    issue: params.issue,
    gateway: params.gateway,
    config: params.config.issues.aiHelp.projectContext,
    templateKey: validation.template?.key ?? validation.parsed.marker
  });

  const aiBody = await generateIssueAiHelp({
    issue: {
      ...params.issue,
      labels: [...effectiveLabels]
    },
    parsed: validation.parsed,
    config: params.config.issues.aiHelp,
    commentMode,
    repositoryContext,
    provider: params.provider
  });

  if (!aiBody) {
    return;
  }

  await upsertAnchoredComment({
    gateway: params.gateway,
    issueNumber: params.issue.number,
    anchor: params.config.issues.aiHelp.commentAnchor,
    body: aiBody
  });
}
