import * as core from "@actions/core";

import type {
  IssueContext,
  LabelDefinition,
  LabelingAiClassificationConfig,
  ParsedIssue,
  RepositoryAiContext
} from "../../core/types.js";
import type { GitHubGateway } from "../../github/gateway.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function classifyIssueContentLabels(params: {
  issue: IssueContext;
  parsed: ParsedIssue;
  config: LabelingAiClassificationConfig;
  gateway: GitHubGateway;
  repositoryContext: RepositoryAiContext;
  provider?: OpenAiCompatibleProvider;
}): Promise<{
  labels: string[];
  definitions: Record<string, LabelDefinition>;
}> {
  if (!params.config.enabled) {
    return { labels: [], definitions: {} };
  }

  if (!params.provider) {
    core.info("Skip AI label classification because provider is unavailable.");
    return { labels: [], definitions: {} };
  }

  const owner = params.config.sourceRepository.owner.trim() || params.issue.owner;
  const repo = params.config.sourceRepository.repo.trim() || params.issue.repo;
  const labelCatalog = await params.gateway.getRepositoryLabels({ owner, repo });

  let entries = Object.entries(labelCatalog);
  if (params.config.include.length > 0) {
    const include = new Set(params.config.include);
    entries = entries.filter(([name]) => include.has(name));
  }

  if (params.config.exclude.length > 0) {
    const exclude = new Set(params.config.exclude);
    entries = entries.filter(([name]) => !exclude.has(name));
  }

  if (entries.length === 0) {
    core.info(`Skip AI label classification because no candidate labels are available from ${owner}/${repo}.`);
    return { labels: [], definitions: {} };
  }

  try {
    const classified = await params.provider.classifyIssueLabels({
      issue: params.issue,
      parsed: params.parsed,
      repositoryContext: params.repositoryContext,
      availableLabels: entries.map(([name, definition]) => ({
        name,
        description: definition.description
      })),
      maxLabels: params.config.maxLabels,
      prompt: params.config.prompt
    });

    const allowed = new Map(entries);
    const selected = unique(classified
      .filter((item) => item.confidence >= params.config.minConfidence)
      .map((item) => item.name))
      .filter((name) => allowed.has(name))
      .slice(0, params.config.maxLabels);

    const definitions = Object.fromEntries(selected
      .map((name) => [name, allowed.get(name)])
      .filter((entry): entry is [string, LabelDefinition] => Boolean(entry[1])));

    if (selected.length > 0) {
      core.info(`AI label classification selected: ${selected.join(", ")}`);
    } else {
      core.info("AI label classification did not select any labels above the confidence threshold.");
    }

    return {
      labels: selected,
      definitions
    };
  } catch (error) {
    core.warning(`Skip AI label classification because provider request failed: ${String(error)}`);
    return { labels: [], definitions: {} };
  }
}
