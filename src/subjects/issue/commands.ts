import type {
  IssueCommandType,
  IssueCommentCommandContext,
  IssueCommentContext,
  RepoBotConfig
} from "../../core/types.js";
import type { GitHubGateway } from "../../github/gateway.js";
import type { OpenAiCompatibleProvider } from "../../providers/openaiCompatible/client.js";
import { runIssueFixCommand } from "./fix.js";
import { runIssueWorkflow } from "./run.js";

const COLLABORATOR_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFirstPlainTextLine(body: string): string | undefined {
  const lines = body.split(/\r?\n/);
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock || !trimmed) {
      continue;
    }

    if (/^(>+|[-*+]\s|\d+\.\s)/.test(trimmed)) {
      continue;
    }

    return trimmed;
  }

  return undefined;
}

export function parseIssueCommentCommand(params: {
  comment: IssueCommentContext;
  mentions: string[];
}): IssueCommentCommandContext | undefined {
  if (params.comment.commentAuthorType.toLowerCase() === "bot") {
    return undefined;
  }

  const firstLine = extractFirstPlainTextLine(params.comment.commentBody);
  if (!firstLine) {
    return undefined;
  }

  const mentions = [...new Set(params.mentions.map((item) => item.trim()).filter(Boolean))];
  if (mentions.length === 0) {
    return undefined;
  }

  const pattern = new RegExp(`^(${mentions.map(escapeRegex).join("|")})\\s+/(fix|refresh)\\b`, "i");
  const match = firstLine.match(pattern);
  if (!match?.[2]) {
    return undefined;
  }

  return {
    ...params.comment,
    commandLine: firstLine,
    command: match[2].toLowerCase() as IssueCommandType
  };
}

export function canExecuteIssueCommentCommand(params: {
  command: IssueCommentCommandContext;
  config: RepoBotConfig["issues"]["commands"];
}): boolean {
  if (!params.config.enabled) {
    return false;
  }

  if (params.config.access === "collaborators") {
    return COLLABORATOR_ASSOCIATIONS.has(params.command.commentAuthorAssociation.toUpperCase());
  }

  return false;
}

export function isIssueCommentCommandEnabled(params: {
  command: IssueCommentCommandContext;
  config: RepoBotConfig["issues"]["commands"];
}): boolean {
  if (!params.config.enabled) {
    return false;
  }

  switch (params.command.command) {
    case "fix":
      return params.config.fix.enabled;
    case "refresh":
      return params.config.refresh.enabled;
    default:
      return false;
  }
}

export async function runIssueCommentCommand(params: {
  workspace: string;
  command: IssueCommentCommandContext;
  config: RepoBotConfig;
  gateway: GitHubGateway;
  provider?: OpenAiCompatibleProvider;
}): Promise<void> {
  await params.gateway.addIssueCommentReaction(params.command.commentId, "eyes");

  try {
    if (params.command.command === "refresh") {
      await runIssueWorkflow({
        issue: params.command.issue,
        trigger: "command_refresh",
        config: params.config,
        gateway: params.gateway,
        provider: params.provider
      });
      await params.gateway.addIssueCommentReaction(params.command.commentId, "rocket");
      return;
    }

    const outcome = await runIssueFixCommand({
      workspace: params.workspace,
      issue: params.command.issue,
      config: params.config,
      gateway: params.gateway,
      provider: params.provider
    });
    await params.gateway.addIssueCommentReaction(
      params.command.commentId,
      outcome === "success" ? "rocket" : "confused"
    );
  } catch (error) {
    await params.gateway.addIssueCommentReaction(params.command.commentId, "confused");
    throw error;
  }
}
