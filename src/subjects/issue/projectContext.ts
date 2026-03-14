import * as core from "@actions/core";

import type {
  IssueContext,
  ProjectContextConfig,
  ProjectProfile,
  RepositoryAiContext,
  RepositoryMetadata
} from "../../core/types.js";
import type { GitHubGateway } from "../../github/gateway.js";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdown(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function buildProjectProfile(
  config: ProjectContextConfig,
  metadata: RepositoryMetadata
): ProjectProfile {
  return {
    name: config.profile.name.trim() || metadata.repo,
    aliases: uniqueValues(config.profile.aliases),
    summary: config.profile.summary.trim() || metadata.description.trim(),
    techStack: uniqueValues(config.profile.techStack)
  };
}

export function createReadmeExcerpt(markdown: string, maxChars: number): string {
  const normalized = normalizeWhitespace(stripMarkdown(markdown));
  if (!normalized) {
    return "";
  }

  return truncateText(normalized, maxChars);
}

export async function resolveRepositoryAiContext(params: {
  issue: IssueContext;
  gateway: GitHubGateway;
  config: ProjectContextConfig;
  templateKey?: string;
}): Promise<RepositoryAiContext> {
  const fallbackMetadata: RepositoryMetadata = {
    owner: params.issue.owner,
    repo: params.issue.repo,
    fullName: `${params.issue.owner}/${params.issue.repo}`,
    description: "",
    topics: [],
    homepage: ""
  };

  if (!params.config.enabled) {
    return {
      ...fallbackMetadata,
      issueUrl: params.issue.htmlUrl,
      templateKey: params.templateKey ?? "unknown",
      readmeExcerpt: "",
      projectProfile: {
        name: fallbackMetadata.repo,
        aliases: [],
        summary: "",
        techStack: []
      }
    };
  }

  let metadata = fallbackMetadata;
  if (params.config.includeRepositoryMetadata) {
    try {
      metadata = await params.gateway.getRepositoryMetadata();
    } catch (error) {
      core.info(`Skip repository metadata context: ${String(error)}`);
    }
  }

  let readmeExcerpt = "";
  if (params.config.includeReadme) {
    try {
      const readme = await params.gateway.getRepositoryReadme();
      if (readme) {
        readmeExcerpt = createReadmeExcerpt(readme, params.config.readmeMaxChars);
      }
    } catch (error) {
      core.info(`Skip repository README context: ${String(error)}`);
    }
  }

  return {
    ...metadata,
    issueUrl: params.issue.htmlUrl,
    templateKey: params.templateKey ?? "unknown",
    readmeExcerpt,
    projectProfile: buildProjectProfile(params.config, metadata)
  };
}
