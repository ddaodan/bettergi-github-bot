import { describe, expect, it } from "vitest";

import type { OpenAiCompatibleProvider } from "../../../src/providers/openaiCompatible/client.js";
import { runIssueWorkflow } from "../../../src/subjects/issue/run.js";
import { createConfig, createIssue, FakeGateway } from "../../helpers/fixtures.js";

describe("runIssueWorkflow", () => {
  it("comments and labels invalid issues", async () => {
    const config = createConfig();
    const issue = createIssue({
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## 环境信息",
        "Windows 11",
        "",
        "## 复现步骤",
        "请填写"
      ].join("\n")
    });
    const gateway = new FakeGateway(issue);

    await runIssueWorkflow({
      issue,
      config,
      gateway
    });

    expect(gateway.comments).toHaveLength(1);
    expect(gateway.comments[0]?.body).toContain("issue-bot:validation");
    expect(issue.labels).toContain("needs-template-fix");
  });

  it("runs bilingual AI reply after labeling adds trigger label in the same run", async () => {
    const config = createConfig();
    config.issues.aiHelp.enabled = true;
    const issue = createIssue({
      title: "Plugin crash when loading config after startup",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Paper 1.21 / Java 21",
        "",
        "## Steps to Reproduce",
        "1. Start the server",
        "2. Load the plugin and wait for crash",
        "",
        "## Expected Behavior",
        "The plugin should boot successfully without crash"
      ].join("\n")
    });
    const gateway = new FakeGateway(issue);
    const provider = {
      async generateHelp() {
        return {
          summary: "Configuration loading fails during startup.",
          possibleCauses: ["Invalid configuration value"],
          troubleshootingSteps: ["Check the generated stack trace"],
          missingInformation: []
        };
      },
      async reviewDuplicate() {
        return {
          duplicate: false,
          confidence: 0.2,
          reason: ""
        };
      }
    } as unknown as OpenAiCompatibleProvider;

    await runIssueWorkflow({
      issue,
      config,
      gateway,
      provider
    });

    expect(issue.labels).toContain("needs-ai-help");
    expect(gateway.comments).toHaveLength(2);
    expect(gateway.comments[1]?.body).toContain("AI 分析建议");
    expect(gateway.comments[1]?.body).toContain("AI Guidance");
  });

  it("closes duplicate issue and skips AI help", async () => {
    const config = createConfig();
    config.issues.aiHelp.enabled = true;
    const issue = createIssue();
    const gateway = new FakeGateway(issue, [
      {
        number: 9,
        title: issue.title,
        body: issue.body,
        labels: [],
        state: "open",
        htmlUrl: "https://example.test/issues/9",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z"
      }
    ]);
    const provider = {
      async generateHelp() {
        return {
          summary: "should not run",
          possibleCauses: [],
          troubleshootingSteps: [],
          missingInformation: []
        };
      },
      async reviewDuplicate() {
        return {
          duplicate: true,
          confidence: 0.99,
          reason: "same issue"
        };
      }
    } as unknown as OpenAiCompatibleProvider;

    await runIssueWorkflow({
      issue,
      config,
      gateway,
      provider
    });

    expect(gateway.closedIssues).toEqual([1]);
    expect(gateway.comments.some((comment) => comment.body.includes("AI 分析建议"))).toBe(false);
  });
});
