import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";

import type {
  DuplicateCandidate,
  IssueCommentContext,
  IssueContext,
  LabelDefinition,
  RepositoryMetadata
} from "../core/types.js";

type IssueLabelValue = {
  name?: string | null;
};

export interface CommentRecord {
  id: number;
  body: string;
  authorLogin?: string;
}

export interface SearchIssueParams {
  owner: string;
  repo: string;
  currentIssueNumber: number;
  terms: string[];
  limit: number;
}

export interface GitHubGateway {
  getIssueContext(): Promise<IssueContext | undefined>;
  getIssueCommentContext(): Promise<IssueCommentContext | undefined>;
  getRepositoryMetadata(): Promise<RepositoryMetadata>;
  getRepositoryReadme(): Promise<string | undefined>;
  listComments(issueNumber: number): Promise<CommentRecord[]>;
  createComment(issueNumber: number, body: string): Promise<void>;
  updateComment(commentId: number, body: string): Promise<void>;
  deleteComment(commentId: number): Promise<void>;
  addIssueCommentReaction(commentId: number, reaction: "eyes" | "rocket" | "confused"): Promise<void>;
  addLabels(issueNumber: number, labels: string[]): Promise<void>;
  removeLabel(issueNumber: number, label: string): Promise<void>;
  ensureLabels(definitions: Record<string, LabelDefinition>, labels: string[]): Promise<void>;
  closeIssue(issueNumber: number): Promise<void>;
  searchIssues(params: SearchIssueParams): Promise<DuplicateCandidate[]>;
}

function toIssueContext(): IssueContext | undefined {
  const issue = context.payload.issue;
  if (!issue || "pull_request" in issue) {
    return undefined;
  }

  return {
    kind: "issue",
    owner: context.repo.owner,
    repo: context.repo.repo,
    number: issue.number,
    title: issue.title ?? "",
    body: issue.body ?? "",
    state: issue.state as "open" | "closed",
    labels: issue.labels.map((label: string | IssueLabelValue) => typeof label === "string" ? label : label.name ?? "").filter(Boolean),
    htmlUrl: issue.html_url ?? "",
    createdAt: issue.created_at ?? "",
    updatedAt: issue.updated_at ?? "",
    action: context.payload.action ?? ""
  };
}

function toIssueCommentContext(): IssueCommentContext | undefined {
  const issue = toIssueContext();
  const comment = context.payload.comment;
  if (!issue || !comment) {
    return undefined;
  }

  return {
    issue,
    commentId: comment.id,
    commentBody: comment.body ?? "",
    commentAuthorLogin: comment.user?.login ?? "",
    commentAuthorType: comment.user?.type ?? "",
    commentAuthorAssociation: comment.author_association ?? "",
    action: context.payload.action ?? ""
  };
}

export class OctokitGitHubGateway implements GitHubGateway {
  private readonly octokit;

  public constructor(
    token: string,
    private readonly dryRun: boolean
  ) {
    this.octokit = getOctokit(token);
  }

  public async getIssueContext(): Promise<IssueContext | undefined> {
    return toIssueContext();
  }

  public async getIssueCommentContext(): Promise<IssueCommentContext | undefined> {
    return toIssueCommentContext();
  }

  public async getRepositoryMetadata(): Promise<RepositoryMetadata> {
    const response = await this.octokit.rest.repos.get({
      owner: context.repo.owner,
      repo: context.repo.repo
    });

    return {
      owner: context.repo.owner,
      repo: context.repo.repo,
      fullName: response.data.full_name ?? `${context.repo.owner}/${context.repo.repo}`,
      description: response.data.description ?? "",
      topics: response.data.topics ?? [],
      homepage: response.data.homepage ?? ""
    };
  }

  public async getRepositoryReadme(): Promise<string | undefined> {
    try {
      const response = await this.octokit.rest.repos.getReadme({
        owner: context.repo.owner,
        repo: context.repo.repo
      });

      const encoded = "content" in response.data ? response.data.content ?? "" : "";
      if (!encoded) {
        return undefined;
      }

      return Buffer.from(encoded, "base64").toString("utf8");
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? (error as { status?: number }).status
        : undefined;
      if (status === 404) {
        return undefined;
      }
      core.info(`Skip repository README context: ${String(error)}`);
      return undefined;
    }
  }

  public async listComments(issueNumber: number): Promise<CommentRecord[]> {
    const response = await this.octokit.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      per_page: 100
    });

    return response.data.map((comment) => ({
      id: comment.id,
      body: comment.body ?? "",
      authorLogin: comment.user?.login
    }));
  }

  public async createComment(issueNumber: number, body: string): Promise<void> {
    if (this.dryRun) {
      core.info(`[dry-run] create comment on issue #${issueNumber}`);
      return;
    }

    await this.octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      body
    });
  }

  public async updateComment(commentId: number, body: string): Promise<void> {
    if (this.dryRun) {
      core.info(`[dry-run] update comment #${commentId}`);
      return;
    }

    await this.octokit.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: commentId,
      body
    });
  }

  public async deleteComment(commentId: number): Promise<void> {
    if (this.dryRun) {
      core.info(`[dry-run] delete comment #${commentId}`);
      return;
    }

    await this.octokit.rest.issues.deleteComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: commentId
    });
  }

  public async addIssueCommentReaction(commentId: number, reaction: "eyes" | "rocket" | "confused"): Promise<void> {
    if (this.dryRun) {
      core.info(`[dry-run] add reaction ${reaction} to issue comment #${commentId}`);
      return;
    }

    try {
      await this.octokit.rest.reactions.createForIssueComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: commentId,
        content: reaction
      });
    } catch (error) {
      core.info(`Skip adding reaction "${reaction}" to issue comment #${commentId}: ${String(error)}`);
    }
  }

  public async addLabels(issueNumber: number, labels: string[]): Promise<void> {
    if (labels.length === 0) {
      return;
    }
    if (this.dryRun) {
      core.info(`[dry-run] add labels to issue #${issueNumber}: ${labels.join(", ")}`);
      return;
    }

    await this.octokit.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      labels
    });
  }

  public async removeLabel(issueNumber: number, label: string): Promise<void> {
    if (this.dryRun) {
      core.info(`[dry-run] remove label from issue #${issueNumber}: ${label}`);
      return;
    }

    try {
      await this.octokit.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        name: label
      });
    } catch (error) {
      core.info(`Skip removing label "${label}": ${String(error)}`);
    }
  }

  public async ensureLabels(definitions: Record<string, LabelDefinition>, labels: string[]): Promise<void> {
    if (labels.length === 0) {
      return;
    }

    const existing = await this.octokit.paginate(this.octokit.rest.issues.listLabelsForRepo, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      per_page: 100
    });

    const existingNames = new Set(existing.map((label) => label.name));
    for (const name of labels) {
      if (existingNames.has(name)) {
        continue;
      }

      const definition = definitions[name];
      if (!definition) {
        core.info(`Skip auto-creating undefined label "${name}".`);
        continue;
      }

      if (this.dryRun) {
        core.info(`[dry-run] create label "${name}"`);
        continue;
      }

      await this.octokit.rest.issues.createLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name,
        color: definition.color,
        description: definition.description
      });
    }
  }

  public async closeIssue(issueNumber: number): Promise<void> {
    if (this.dryRun) {
      core.info(`[dry-run] close issue #${issueNumber}`);
      return;
    }

    await this.octokit.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      state: "closed"
    });
  }

  public async searchIssues(params: SearchIssueParams): Promise<DuplicateCandidate[]> {
    const terms = params.terms.map((term) => `"${term}"`).join(" ");
    const query = [
      `repo:${params.owner}/${params.repo}`,
      "is:issue",
      terms
    ].filter(Boolean).join(" ");

    const searchResponse = await this.octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: Math.min(params.limit, 100),
      sort: "updated",
      order: "desc"
    });

    const directMatches = searchResponse.data.items
      .filter((item) => !("pull_request" in item) && item.number !== params.currentIssueNumber)
      .map((item) => ({
        number: item.number,
        title: item.title,
        body: item.body ?? "",
        labels: item.labels.map((label: string | IssueLabelValue) => typeof label === "string" ? label : label.name ?? "").filter(Boolean),
        state: item.state as "open" | "closed",
        htmlUrl: item.html_url ?? "",
        createdAt: item.created_at ?? "",
        updatedAt: item.updated_at ?? ""
      }));

    if (directMatches.length >= params.limit) {
      return directMatches.slice(0, params.limit);
    }

    const fallbackIssues = await this.octokit.paginate(this.octokit.rest.issues.listForRepo, {
      owner: params.owner,
      repo: params.repo,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100
    });

    const merged = new Map<number, DuplicateCandidate>();
    for (const item of directMatches) {
      merged.set(item.number, item);
    }

    for (const issue of fallbackIssues) {
      if (issue.pull_request || issue.number === params.currentIssueNumber) {
        continue;
      }

      merged.set(issue.number, {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        labels: issue.labels.map((label: string | IssueLabelValue) => typeof label === "string" ? label : label.name ?? "").filter(Boolean),
        state: issue.state as "open" | "closed",
        htmlUrl: issue.html_url ?? "",
        createdAt: issue.created_at ?? "",
        updatedAt: issue.updated_at ?? ""
      });

      if (merged.size >= params.limit) {
        break;
      }
    }

    return [...merged.values()];
  }
}
