import * as core from "@actions/core";

import { loadRepoBotConfig } from "./config/loadConfig.js";
import { OctokitGitHubGateway } from "./github/gateway.js";
import { tryCreateProvider } from "./providers/openaiCompatible/client.js";
import { runIssueWorkflow } from "./subjects/issue/run.js";

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
    const issue = await gateway.getIssueContext();

    if (!issue) {
      core.info("Current event is not a plain issue event. Nothing to do.");
      return;
    }

    await runIssueWorkflow({
      issue,
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
