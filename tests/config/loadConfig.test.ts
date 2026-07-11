import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadRepoBotConfig,
  repoBotConfigEnvironmentVariables
} from "../../src/config/loadConfig.js";

describe("loadRepoBotConfig", () => {
  it("merges YAML config with JSON overrides", async () => {
    const workspace = path.join(os.tmpdir(), `repo-bot-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
    const configDir = path.join(workspace, ".github");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "repo-bot.yml"), [
      "runtime:",
      "  languageMode: auto",
      "issues:",
      "  aiHelp:",
      "    enabled: false"
    ].join("\n"));

    const config = await loadRepoBotConfig({
      workspace,
      configPath: ".github/repo-bot.yml",
      overridesJson: JSON.stringify({
        runtime: {
          dryRun: true
        },
        issues: {
          aiHelp: {
            enabled: true,
            projectContext: {
              profile: {
                name: "BetterGI",
                aliases: ["BGI"]
              }
            }
          },
          commands: {
            enabled: true,
            fix: {
              enabled: true
            }
          }
        }
      }),
      dryRunInput: false
    });

    expect(config.runtime.dryRun).toBe(true);
    expect(config.issues.aiHelp.enabled).toBe(true);
    expect(config.runtime.languageMode).toBe("auto");
    expect(config.issues.aiHelp.projectContext.enabled).toBe(true);
    expect(config.issues.aiHelp.projectContext.profile.name).toBe("BetterGI");
    expect(config.issues.aiHelp.projectContext.profile.aliases).toEqual(["BGI"]);
    expect(config.issues.aiHelp.projectContext.readmeMaxChars).toBe(3000);
    expect(config.issues.commands.enabled).toBe(true);
    expect(config.issues.commands.mentions).toEqual(["@bot"]);
    expect(config.issues.commands.fix.commentAnchor).toBe("issue-bot:fix");
    expect(config.issues.autoProcessing.skipCreatedBefore).toBe("");
    expect(config.issues.titleGeneration.enabled).toBe(true);
    expect(config.issues.titleGeneration.detectMismatch).toBe(true);
    expect(config.issues.titleGeneration.maxLength).toBe(100);
  });

  it("prefers AI environment variables over YAML and JSON overrides", async () => {
    const workspace = path.join(os.tmpdir(), `repo-bot-${Date.now()}-secret`);
    await mkdir(workspace, { recursive: true });
    const configDir = path.join(workspace, ".github");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "repo-bot.yml"), [
      "providers:",
      "  openAiCompatible:",
      "    enabled: true",
      "    baseUrl: https://public.example/v1",
      "    model: yaml-model",
      "    apiStyle: auto",
      "    timeoutMs: 30000"
    ].join("\n"));

    const environmentOverrides = {
      REPO_BOT_RUNTIME_LANGUAGE_MODE: "zh-en",
      REPO_BOT_ISSUES_TITLE_GENERATION_MAX_LENGTH: "72",
      REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_THRESHOLDS_REVIEW_MIN: "0.75",
      REPO_BOT_ISSUES_LABELING_MANAGED: '["BUG","重复"]',
      REPO_BOT_ISSUES_AI_HELP_PROJECT_CONTEXT_PROFILE_ALIASES: '["BGI"]',
      REPO_BOT_ISSUES_COMMANDS_REFRESH_ENABLED: "true",
      REPO_BOT_PULL_REQUESTS_REVIEW_ENABLED: "true",
      REPO_BOT_AI_ENABLED: "false",
      REPO_BOT_AI_BASE_URL: "https://environment.example/v1",
      REPO_BOT_AI_MODEL: "gpt-5.5",
      REPO_BOT_AI_API_STYLE: "responses",
      REPO_BOT_AI_TIMEOUT_MS: "60000"
    };
    const environment = Object.fromEntries(
      Object.keys(environmentOverrides).map((name) => [name, process.env[name]])
    );
    Object.assign(process.env, environmentOverrides);

    try {
      const config = await loadRepoBotConfig({
        workspace,
        configPath: ".github/repo-bot.yml",
        overridesJson: JSON.stringify({
          providers: {
            openAiCompatible: {
              model: "input-model"
            }
          }
        }),
        dryRunInput: false
      });

      expect(config.runtime.languageMode).toBe("zh-en");
      expect(config.issues.titleGeneration.maxLength).toBe(72);
      expect(config.issues.validation.duplicateDetection.thresholds.reviewMin).toBe(0.75);
      expect(config.issues.labeling.managed).toEqual(["BUG", "重复"]);
      expect(config.issues.aiHelp.projectContext.profile.aliases).toEqual(["BGI"]);
      expect(config.issues.commands.refresh.enabled).toBe(true);
      expect(config.pullRequests.review.enabled).toBe(true);
      expect(config.providers.openAiCompatible).toEqual({
        enabled: false,
        baseUrl: "https://environment.example/v1",
        model: "gpt-5.5",
        apiStyle: "responses",
        timeoutMs: 60000
      });
    } finally {
      for (const [name, value] of Object.entries(environment)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it("defines a unique environment variable for every supported config path", () => {
    const names = repoBotConfigEnvironmentVariables.map((definition) => definition.name);
    const paths = repoBotConfigEnvironmentVariables.map((definition) => definition.path.join("."));

    expect(new Set(names).size).toBe(names.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect(names).toContain("REPO_BOT_AI_MODEL");
    expect(names).toContain("REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_THRESHOLDS_REVIEW_MIN");
    expect(names).toContain("REPO_BOT_PULL_REQUESTS_SUMMARY_ENABLED");
  });

  it("accepts auto skipCreatedBefore mode", async () => {
    const workspace = path.join(os.tmpdir(), `repo-bot-${Date.now()}-auto-cutoff`);
    await mkdir(workspace, { recursive: true });
    const configDir = path.join(workspace, ".github");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "repo-bot.yml"), [
      "issues:",
      "  autoProcessing:",
      "    skipCreatedBefore: auto"
    ].join("\n"));

    const config = await loadRepoBotConfig({
      workspace,
      configPath: ".github/repo-bot.yml",
      overridesJson: "",
      dryRunInput: false
    });

    expect(config.issues.autoProcessing.skipCreatedBefore).toBe("auto");
  });

  it("accepts unquoted YAML timestamps for skipCreatedBefore", async () => {
    const workspace = path.join(os.tmpdir(), `repo-bot-${Date.now()}-timestamp-cutoff`);
    await mkdir(workspace, { recursive: true });
    const configDir = path.join(workspace, ".github");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "repo-bot.yml"), [
      "issues:",
      "  autoProcessing:",
      "    skipCreatedBefore: 2026-03-20T00:00:00+08:00"
    ].join("\n"));

    const config = await loadRepoBotConfig({
      workspace,
      configPath: ".github/repo-bot.yml",
      overridesJson: "",
      dryRunInput: false
    });

    expect(typeof config.issues.autoProcessing.skipCreatedBefore).toBe("string");
    expect(Date.parse(config.issues.autoProcessing.skipCreatedBefore)).toBe(Date.parse("2026-03-20T00:00:00+08:00"));
  });
});
