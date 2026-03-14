import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadRepoBotConfig } from "../../src/config/loadConfig.js";

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
            enabled: true
          }
        }
      }),
      dryRunInput: false
    });

    expect(config.runtime.dryRun).toBe(true);
    expect(config.issues.aiHelp.enabled).toBe(true);
    expect(config.runtime.languageMode).toBe("auto");
  });

  it("prefers secret baseUrl over YAML config", async () => {
    const workspace = path.join(os.tmpdir(), `repo-bot-${Date.now()}-secret`);
    await mkdir(workspace, { recursive: true });
    const configDir = path.join(workspace, ".github");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "repo-bot.yml"), [
      "providers:",
      "  openAiCompatible:",
      "    enabled: true",
      "    baseUrl: https://public.example/v1",
      "    model: gpt-5-mini"
    ].join("\n"));

    const previous = process.env.REPO_BOT_AI_BASE_URL;
    process.env.REPO_BOT_AI_BASE_URL = "https://secret.example/v1";

    try {
      const config = await loadRepoBotConfig({
        workspace,
        configPath: ".github/repo-bot.yml",
        overridesJson: "",
        dryRunInput: false
      });

      expect(config.providers.openAiCompatible.baseUrl).toBe("https://secret.example/v1");
    } finally {
      if (previous === undefined) {
        delete process.env.REPO_BOT_AI_BASE_URL;
      } else {
        process.env.REPO_BOT_AI_BASE_URL = previous;
      }
    }
  });
});
