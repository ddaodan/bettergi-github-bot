import * as core from "@actions/core";

import { loadRepoBotConfig } from "./config/loadConfig.js";
import { OctokitGitHubGateway } from "./github/gateway.js";
import { tryCreateProvider } from "./providers/openaiCompatible/client.js";
import {
  canExecuteIssueCommentCommand,
  isIssueCommentCommandEnabled,
  parseIssueCommentCommand,
  runIssueCommentCommand
} from "./subjects/issue/commands.js";
import { resolveIssueWorkflowTrigger, runIssueWorkflow } from "./subjects/issue/run.js";

async function run(): Promise<void> {
  try {
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const configPath = core.getInput("config-path") || ".github/repo-bot.yml";
    const overridesJson = core.getInput("config-overrides-json");
    const dryRun = core.getBooleanInput("dry-run", { required: false });

    const config = await loadRepoBotConfig({
      workspace,
      configPath,
      overridesJson,
      dryRunInput: dryRun
    });

    const token = process.env.REPO_BOT_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
    if (!token) {
      throw new Error("Missing REPO_BOT_GITHUB_TOKEN or GITHUB_TOKEN.");
    }

    if (process.env.REPO_BOT_GITHUB_TOKEN?.trim()) {
      core.info("Using REPO_BOT_GITHUB_TOKEN for GitHub API operations.");
    }

    const gateway = new OctokitGitHubGateway(token, config.runtime.dryRun);
    const provider = tryCreateProvider(config.providers.openAiCompatible);
    const issueComment = await gateway.getIssueCommentContext();

    if (issueComment) {
      const command = parseIssueCommentCommand({
        comment: issueComment,
        mentions: config.issues.commands.mentions
      });

      if (!command) {
        core.info("Current issue comment does not contain a supported bot command.");
        return;
      }

      if (!isIssueCommentCommandEnabled({
        command,
        config: config.issues.commands
      })) {
        core.info(`Issue command /${command.command} is disabled or unsupported.`);
        return;
      }

      if (!canExecuteIssueCommentCommand({
        command,
        config: config.issues.commands
      })) {
        core.info(`Ignore issue command /${command.command} due to access restrictions.`);
        return;
      }

      await runIssueCommentCommand({
        workspace,
        command,
        config,
        gateway,
        provider
      });

      core.info(`Repo Bot completed command /${command.command} for issue #${command.issue.number}.`);
      return;
    }

    const issue = await gateway.getIssueContext();

    if (!issue) {
      core.info("Current event is not a plain issue event. Nothing to do.");
      return;
    }

    const trigger = resolveIssueWorkflowTrigger(issue.action);
    if (!trigger) {
      core.info(`Current issue action "${issue.action}" is not handled.`);
      return;
    }

    await runIssueWorkflow({
      issue,
      trigger,
      config,
      gateway,
      provider
    });

    core.info(`Repo Bot completed for issue #${issue.number}.`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void run();
