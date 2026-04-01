import * as core from "@actions/core";

import type {
  CommentMode,
  IssueContext,
  IssueWorkflowTrigger,
  RepoBotConfig,
  RepositoryAiContext,
  SimilarIssueCandidate
} from "../../core/types.js";
import { syncAnchoredComment, upsertAnchoredComment } from "../../github/comments.js";
import type { GitHubGateway } from "../../github/gateway.js";
import { renderDuplicateComment, renderSimilarIssuesComment } from "../../i18n/comments.js";
import { detectCommentMode } from "../../i18n/language.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";
import { classifyIssueContentLabels } from "./aiClassification.js";
import { generateIssueAiHelp } from "./aiHelp.js";
import { detectDuplicate } from "./duplicateDetection.js";
import { computeManagedLabels } from "./labeling.js";
import { resolveRepositoryAiContext } from "./projectContext.js";
import { validateIssue } from "./validation.js";

const AUTO_PROCESSING_CUTOFF_VARIABLE = "REPO_BOT_AUTO_PROCESSING_SKIP_CREATED_BEFORE";
const LEGACY_ISSUE_HARDCODED_CUTOFF = "2026-04-01T00:00:00Z";

export function resolveIssueWorkflowTrigger(action: string): IssueWorkflowTrigger | undefined {
  switch (action) {
    case "opened":
      return "issue_opened";
    case "edited":
      return "issue_edited";
    case "reopened":
      return "issue_reopened";
    case "labeled":
      return "issue_labeled";
    default:
      return undefined;
  }
}

function isAutomaticIssueWorkflowTrigger(trigger: IssueWorkflowTrigger): boolean {
  return trigger !== "command_refresh";
}

async function resolveIssueAutoProcessingCutoff(params: {
  issue: IssueContext;
  trigger: IssueWorkflowTrigger;
  config: RepoBotConfig;
  gateway: GitHubGateway;
}): Promise<string | undefined> {
  if (!isAutomaticIssueWorkflowTrigger(params.trigger)) {
    return undefined;
  }

  const rawCutoff = params.config.issues.autoProcessing.skipCreatedBefore.trim();
  if (!rawCutoff) {
    return undefined;
  }

  if (rawCutoff.toLowerCase() !== "auto") {
    return rawCutoff;
  }

  try {
    const stored = (await params.gateway.getRepositoryVariable(AUTO_PROCESSING_CUTOFF_VARIABLE))?.trim();
    if (stored) {
      if (Number.isNaN(Date.parse(stored))) {
        core.warning(
          `Repository variable ${AUTO_PROCESSING_CUTOFF_VARIABLE} contains an invalid date string: ${stored}. Ignore automatic cutoff.`
        );
        return undefined;
      }

      return stored;
    }
  } catch (error) {
    core.warning(
      `Unable to read repository variable ${AUTO_PROCESSING_CUTOFF_VARIABLE}. Ignore automatic cutoff: ${String(error)}`
    );
    return undefined;
  }

  const activationTimestamp = params.trigger === "issue_opened"
    ? params.issue.createdAt
    : new Date().toISOString();

  try {
    await params.gateway.upsertRepositoryVariable(AUTO_PROCESSING_CUTOFF_VARIABLE, activationTimestamp);
    core.info(
      `Initialized automatic issue cutoff at ${activationTimestamp} in repository variable ${AUTO_PROCESSING_CUTOFF_VARIABLE}.`
    );
  } catch (error) {
    core.warning(
      `Unable to initialize repository variable ${AUTO_PROCESSING_CUTOFF_VARIABLE}. Ignore automatic cutoff: ${String(error)}`
    );
    return undefined;
  }

  return activationTimestamp;
}

async function shouldSkipIssueAutoProcessing(params: {
  issue: IssueContext;
  trigger: IssueWorkflowTrigger;
  config: RepoBotConfig;
  gateway: GitHubGateway;
}): Promise<boolean> {
  if (!isAutomaticIssueWorkflowTrigger(params.trigger)) {
    return false;
  }

  const hardcodedCutoffTimestamp = Date.parse(LEGACY_ISSUE_HARDCODED_CUTOFF);
  const createdTimestamp = Date.parse(params.issue.createdAt);
  if (!Number.isNaN(hardcodedCutoffTimestamp) && !Number.isNaN(createdTimestamp) && createdTimestamp < hardcodedCutoffTimestamp) {
    return true;
  }

  const cutoff = await resolveIssueAutoProcessingCutoff(params);
  if (!cutoff) {
    return false;
  }

  const cutoffTimestamp = Date.parse(cutoff);
  if (Number.isNaN(cutoffTimestamp) || Number.isNaN(createdTimestamp)) {
    return false;
  }

  return createdTimestamp < cutoffTimestamp;
}

function shouldRunValidation(trigger: IssueWorkflowTrigger): boolean {
  return ["issue_opened", "issue_edited", "issue_reopened", "command_refresh"].includes(trigger);
}

function shouldRunLabeling(trigger: IssueWorkflowTrigger): boolean {
  return ["issue_opened", "issue_edited", "issue_reopened", "issue_labeled", "command_refresh"].includes(trigger);
}

function shouldRunAi(trigger: IssueWorkflowTrigger): boolean {
  return ["issue_opened", "issue_edited", "issue_reopened", "issue_labeled", "command_refresh"].includes(trigger);
}

export async function runIssueWorkflow(params: {
  issue: IssueContext;
  trigger: IssueWorkflowTrigger;
  config: RepoBotConfig;
  gateway: GitHubGateway;
  provider?: OpenAiCompatibleProvider;
}): Promise<void> {
  if (await shouldSkipIssueAutoProcessing({
    issue: params.issue,
    trigger: params.trigger,
    config: params.config,
    gateway: params.gateway
  })) {
    core.info(
      `Skip automatic processing for issue #${params.issue.number}: created at ${params.issue.createdAt} is earlier than the automatic cutoff or the hardcoded legacy cutoff ${LEGACY_ISSUE_HARDCODED_CUTOFF}.`
    );
    return;
  }

  const effectiveLabels = new Set(params.issue.labels);
  const commentMode: CommentMode = detectCommentMode(`${params.issue.title}\n${params.issue.body}`, params.config.runtime);
  const validation = validateIssue({
    title: params.issue.title,
    body: params.issue.body,
    config: params.config.issues.validation,
    commentMode
  });

  if (shouldRunValidation(params.trigger)) {
    await syncAnchoredComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      anchor: params.config.issues.validation.commentAnchor,
      body: validation.commentBody
    });
  }

  if (shouldRunValidation(params.trigger) && validation.executed && !validation.valid) {
    core.info("Issue failed template validation. Skip duplicate detection and AI help.");
    await syncAnchoredComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      anchor: params.config.issues.validation.duplicateDetection.similarityComment.commentAnchor
    });
    await syncAnchoredComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      anchor: params.config.issues.aiHelp.commentAnchor
    });
  }

  let duplicated = false;
  let duplicateCommentBody: string | undefined;
  let similarIssues: SimilarIssueCandidate[] = [];
  let repositoryContext: RepositoryAiContext | undefined;
  if (shouldRunValidation(params.trigger) && validation.valid) {
    const duplicateDecision = await detectDuplicate({
      issue: params.issue,
      parsed: validation.parsed,
      config: params.config.issues.validation.duplicateDetection,
      provider: params.provider,
      searchIssues: async (terms, limit) => params.gateway.searchIssues({
        owner: params.issue.owner,
        repo: params.issue.repo,
        currentIssueNumber: params.issue.number,
        terms,
        limit
      }),
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
    if (duplicated && duplicateDecision.duplicateOf) {
      duplicateCommentBody = renderDuplicateComment({
        mode: commentMode,
        duplicateOf: duplicateDecision.duplicateOf,
        confidence: duplicateDecision.confidence ?? 0
      });
    } else {
      similarIssues = duplicateDecision.similarIssues ?? [];
    }
  }

  if (shouldRunValidation(params.trigger) && duplicated) {
    await syncAnchoredComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      anchor: params.config.issues.validation.duplicateDetection.similarityComment.commentAnchor,
      body: duplicateCommentBody
    });
    await syncAnchoredComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      anchor: params.config.issues.aiHelp.commentAnchor
    });
  }

  if (shouldRunLabeling(params.trigger) && params.config.issues.labeling.enabled && !duplicated) {
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

    if (params.config.issues.labeling.aiClassification.enabled) {
      repositoryContext ??= await resolveRepositoryAiContext({
        issue: params.issue,
        gateway: params.gateway,
        config: params.config.issues.aiHelp.projectContext,
        templateKey: validation.template?.key ?? validation.parsed.marker
      });

      const classified = await classifyIssueContentLabels({
        issue: {
          ...params.issue,
          labels: [...effectiveLabels]
        },
        parsed: validation.parsed,
        config: params.config.issues.labeling.aiClassification,
        gateway: params.gateway,
        repositoryContext,
        provider: params.provider
      });

      const labelsToAdd = classified.labels.filter((label) => !effectiveLabels.has(label));
      if (params.config.issues.labeling.autoCreateMissing) {
        await params.gateway.ensureLabels({
          ...params.config.issues.labeling.definitions,
          ...classified.definitions
        }, labelsToAdd);
      }

      if (labelsToAdd.length > 0) {
        await params.gateway.addLabels(params.issue.number, labelsToAdd);
        for (const label of labelsToAdd) {
          effectiveLabels.add(label);
        }
      }
    }
  }

  if (duplicated || !shouldRunAi(params.trigger) || !validation.valid) {
    if (!duplicated && shouldRunValidation(params.trigger)) {
      const similarIssuesBody = similarIssues.length > 0
        ? renderSimilarIssuesComment({
          mode: commentMode,
          issues: similarIssues
        })
        : undefined;

      await syncAnchoredComment({
        gateway: params.gateway,
        issueNumber: params.issue.number,
        anchor: params.config.issues.validation.duplicateDetection.similarityComment.commentAnchor,
        body: similarIssuesBody
      });
    }
    return;
  }

  repositoryContext ??= await resolveRepositoryAiContext({
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
    relatedIssues: similarIssues,
    provider: params.provider
  });

  if (!aiBody) {
    if (shouldRunValidation(params.trigger)) {
      const similarIssuesBody = similarIssues.length > 0
        ? renderSimilarIssuesComment({
          mode: commentMode,
          issues: similarIssues
        })
        : undefined;

      await syncAnchoredComment({
        gateway: params.gateway,
        issueNumber: params.issue.number,
        anchor: params.config.issues.validation.duplicateDetection.similarityComment.commentAnchor,
        body: similarIssuesBody
      });
    }
    return;
  }

  await upsertAnchoredComment({
    gateway: params.gateway,
    issueNumber: params.issue.number,
    anchor: params.config.issues.aiHelp.commentAnchor,
    body: aiBody
  });

  if (shouldRunValidation(params.trigger)) {
    await syncAnchoredComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      anchor: params.config.issues.validation.duplicateDetection.similarityComment.commentAnchor
    });
  }
}
