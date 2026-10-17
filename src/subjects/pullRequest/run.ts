import * as core from "@actions/core";

import type { CommentMode, PullRequestContext, RepoBotConfig } from "../../core/types.js";
import { syncAnchoredComment } from "../../github/comments.js";
import type { GitHubGateway } from "../../github/gateway.js";
import { renderPullRequestIssueLinkComment, renderPullRequestLocationComment } from "../../i18n/comments.js";
import { appendCloseKeywords, collectPullRequestIssueReferences } from "./issueLink.js";
import { checkPullRequestFileLocations } from "./locationCheck.js";
import { classifyPullRequestFiles } from "./pathClassification.js";

export type PullRequestWorkflowTrigger = "pull_request_opened" | "pull_request_synchronize";

/**
 * Resolves which pull request workflow handlers should run for the given action.
 * Returns undefined when the action is not handled.
 */
export function resolvePullRequestWorkflowTrigger(action: string): PullRequestWorkflowTrigger | undefined {
  switch (action) {
    case "opened":
    case "reopened":
    case "edited":
      return "pull_request_opened";
    case "synchronize":
    case "ready_for_review":
      return "pull_request_synchronize";
    default:
      return undefined;
  }
}

export async function runPullRequestWorkflow(params: {
  pullRequest: PullRequestContext;
  trigger: PullRequestWorkflowTrigger;
  config: RepoBotConfig;
  gateway: GitHubGateway;
  commentMode: CommentMode;
}): Promise<void> {
  const { config, gateway, pullRequest } = params;
  const prConfig = config.pullRequests;

  if (pullRequest.isDraft) {
    core.info(`Skip draft pull request #${pullRequest.number}.`);
    return;
  }

  if (prConfig.pathLabels.enabled) {
    await runPathLabels({ gateway, pullRequest, config });
  }

  if (prConfig.locationCheck.enabled) {
    await runLocationCheck({ gateway, pullRequest, config, commentMode: params.commentMode });
  }

  if (prConfig.issueLink.enabled) {
    await runIssueLink({ gateway, pullRequest, config, commentMode: params.commentMode });
  }
}

async function runPathLabels(params: {
  gateway: GitHubGateway;
  pullRequest: PullRequestContext;
  config: RepoBotConfig;
}): Promise<void> {
  const { gateway, pullRequest, config } = params;
  const labelConfig = config.pullRequests.pathLabels;

  const files = await gateway.listPullRequestFiles(pullRequest.number);
  const classification = classifyPullRequestFiles({
    files: files.map((file) => file.filename),
    rules: labelConfig.rules,
    scriptRoots: config.pullRequests.locationCheck.scriptRoots
  });

  const desired = new Set(classification.matchedLabels);
  if (classification.documentationOnly && labelConfig.documentationLabel) {
    desired.add(labelConfig.documentationLabel);
  }

  const removable = new Set(labelConfig.rules.map((rule) => rule.label));
  if (labelConfig.documentationLabel) {
    removable.add(labelConfig.documentationLabel);
  }

  const toAdd = [...desired].filter((label) => !pullRequest.labels.includes(label));
  if (toAdd.length > 0) {
    await gateway.addLabels(pullRequest.number, toAdd);
    core.info(`Added labels to #${pullRequest.number}: ${toAdd.join(", ")}`);
  }

  if (!labelConfig.managed) {
    return;
  }

  const stale = pullRequest.labels.filter((label) => removable.has(label) && !desired.has(label));
  for (const label of stale) {
    await gateway.removeLabel(pullRequest.number, label);
    core.info(`Removed stale label "${label}" from #${pullRequest.number}.`);
  }
}

async function runLocationCheck(params: {
  gateway: GitHubGateway;
  pullRequest: PullRequestContext;
  config: RepoBotConfig;
  commentMode: CommentMode;
}): Promise<void> {
  const { gateway, pullRequest, config, commentMode } = params;
  const checkConfig = config.pullRequests.locationCheck;

  const files = await gateway.listPullRequestFiles(pullRequest.number);
  const changed = files
    .filter((file) => file.status === "added" || file.status === "renamed" || file.status === "modified")
    .map((file) => file.filename);

  const issues = checkPullRequestFileLocations({ files: changed, config: checkConfig });

  await syncAnchoredComment({
    gateway,
    issueNumber: pullRequest.number,
    anchor: checkConfig.commentAnchor,
    body: issues.length > 0
      ? renderPullRequestLocationComment({ mode: commentMode, issues })
      : undefined
  });

  if (issues.length > 0) {
    core.info(`Reported ${issues.length} placement issue(s) on pull request #${pullRequest.number}.`);
  }
}

async function runIssueLink(params: {
  gateway: GitHubGateway;
  pullRequest: PullRequestContext;
  config: RepoBotConfig;
  commentMode: CommentMode;
}): Promise<void> {
  const { gateway, pullRequest, config, commentMode } = params;
  const linkConfig = config.pullRequests.issueLink;

  const references = collectPullRequestIssueReferences({
    title: pullRequest.title,
    body: pullRequest.body,
    commitMessages: []
  });

  if (references.length === 0) {
    return;
  }

  const closable: number[] = [];
  for (const reference of references) {
    if (linkConfig.requireSameRepository) {
      const state = await gateway.getIssueStateForRepository({
        owner: pullRequest.owner,
        repo: pullRequest.repo,
        number: reference.number
      });
      if (!state || state.state !== "open") {
        core.info(`Skip issue #${reference.number}: not an open issue in this repository.`);
        continue;
      }
    }
    if (!reference.hasCloseKeyword) {
      closable.push(reference.number);
    }
  }

  if (!linkConfig.appendCloseKeyword) {
    return;
  }

  const addedKeywords: string[] = [];
  if (closable.length > 0) {
    const updatedBody = appendCloseKeywords({
      body: pullRequest.body,
      numbers: closable,
      template: linkConfig.closeKeywordTemplate
    });
    if (updatedBody !== pullRequest.body) {
      await gateway.updatePullRequestBody(pullRequest.number, updatedBody);
      for (const number of closable) {
        addedKeywords.push(linkConfig.closeKeywordTemplate.replace("{number}", String(number)));
      }
      pullRequest.body = updatedBody;
      core.info(`Appended close keyword for issue(s) ${closable.map((n) => `#${n}`).join(", ")}.`);
    }
  }

  await syncAnchoredComment({
    gateway,
    issueNumber: pullRequest.number,
    anchor: linkConfig.commentAnchor,
    body: renderPullRequestIssueLinkComment({
      mode: commentMode,
      linkedNumbers: references.map((reference) => reference.number),
      appendedKeywords: addedKeywords
    })
  });
}
