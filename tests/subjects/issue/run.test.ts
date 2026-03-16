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
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "Please fill",
        "",
        "## Expected Behavior",
        "The plugin should start successfully"
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

  it("does not comment on valid issues when ai help is disabled", async () => {
    const config = createConfig();
    const issue = createIssue();
    const gateway = new FakeGateway(issue);

    await runIssueWorkflow({
      issue,
      config,
      gateway
    });

    expect(issue.labels).toContain("type:bug");
    expect(gateway.comments).toHaveLength(0);
  });

  it("adds a collapsible similar-issues comment when candidates are close but AI help is unavailable", async () => {
    const config = createConfig();
    const issue = createIssue({
      title: "[bug] 一条龙设置无法保存",
      body: [
        "## Environment",
        "Windows 11",
        "",
        "## BetterGI Version",
        "0.58.0",
        "",
        "## Description of the issue",
        "一条龙相关的任何配置都没法保存",
        "",
        "## Steps to Reproduce",
        "打开一条龙界面后保存失败",
        "",
        "## Expected Behavior",
        "应该能够正常保存一条龙配置"
      ].join("\n")
    });
    const gateway = new FakeGateway(issue, [
      {
        number: 17,
        title: "[bug] 一条龙设置保存失败，读取配置组失败，脚本读取失败",
        body: [
          "## Environment",
          "win11",
          "",
          "## BetterGI Version",
          "0.58.0",
          "",
          "## Description of the issue",
          "一条龙设置保存失败，读取配置组失败，脚本读取失败",
          "",
          "## Steps to Reproduce",
          "打开对应界面，更改配置时会出现",
          "",
          "## Expected Behavior",
          "应该能够正常保存配置"
        ].join("\n"),
        labels: ["bug"],
        state: "open",
        htmlUrl: "https://example.test/issues/17",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z"
      }
    ]);

    await runIssueWorkflow({
      issue,
      config,
      gateway
    });

    expect(gateway.comments).toHaveLength(1);
    expect(gateway.comments[0]?.body).toContain("issue-bot:similar-issues");
    expect(gateway.comments[0]?.body).toContain("#17 | 相似度：");
    expect(gateway.comments[0]?.body).toContain("<details>");
  });

  it("merges related issues into the AI comment when AI help is generated", async () => {
    const config = createConfig();
    config.issues.aiHelp.enabled = true;
    config.issues.aiHelp.triggerLabels = ["needs-ai-help"];
    config.issues.labeling.keywordRules = [
      {
        keywords: ["一条龙"],
        labels: ["needs-ai-help"],
        fields: ["title", "body"],
        caseSensitive: false
      }
    ];
    const issue = createIssue({
      title: "[bug] 一条龙设置无法保存",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "打开一条龙界面后保存失败",
        "",
        "## Expected Behavior",
        "应该能够正常保存一条龙配置"
      ].join("\n")
    });
    const gateway = new FakeGateway(issue, [
      {
        number: 17,
        title: "[bug] 一条龙设置保存失败，读取配置组失败，脚本读取失败",
        body: [
          "## Environment",
          "win11",
          "",
          "## Steps to Reproduce",
          "打开对应界面，更改配置时会出现",
          "",
          "## Expected Behavior",
          "应该能够正常保存配置"
        ].join("\n"),
        labels: ["bug"],
        state: "open",
        htmlUrl: "https://example.test/issues/17",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z"
      }
    ]);
    const provider = {
      async generateHelp() {
        return {
          summary: "一条龙配置保存失败。",
          possibleCauses: ["配置文件结构异常"],
          troubleshootingSteps: ["检查配置文件"],
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

    expect(gateway.comments).toHaveLength(1);
    expect(gateway.comments[0]?.body).toContain("issue-bot:ai");
    expect(gateway.comments[0]?.body).toContain("## 可能相关的历史 Issue");
    expect(gateway.comments[0]?.body).toContain("#17 | 相似度：");
    expect(gateway.comments[0]?.body.indexOf("## 可能相关的历史 Issue")).toBeLessThan(
      gateway.comments[0]?.body.indexOf("## AI 分析建议") ?? Number.MAX_SAFE_INTEGER
    );
    expect(gateway.comments[0]?.body).toContain("## AI 分析建议");
    expect(gateway.comments.some((comment) => comment.body.includes("issue-bot:similar-issues"))).toBe(false);
  });

  it("removes the old validation comment after the issue is fixed", async () => {
    const config = createConfig();
    const issue = createIssue({
      action: "edited"
    });
    const gateway = new FakeGateway(issue);

    await gateway.createComment(issue.number, [
      "<!-- issue-bot:validation -->",
      "## 模板检查结果",
      "",
      "Issue 未通过模板检查，请补充以下必填内容：",
      "- Steps to Reproduce"
    ].join("\n"));

    await runIssueWorkflow({
      issue,
      config,
      gateway
    });

    expect(gateway.comments).toHaveLength(0);
    expect(gateway.deletedCommentIds).toHaveLength(1);
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
    let capturedContext: Record<string, unknown> | undefined;
    const provider = {
      async generateHelp(_issue: unknown, _sections: unknown, repositoryContext: Record<string, unknown>) {
        capturedContext = repositoryContext;
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
    expect(gateway.comments).toHaveLength(1);
    expect(gateway.comments[0]?.body).toContain("issue-bot:ai");
    expect(gateway.comments[0]?.body).toContain("AI Guidance");
    expect(gateway.comments[0]?.body).toContain("Configuration loading fails during startup.");
    expect(gateway.comments[0]?.body).toContain("> Note: This response was generated by AI for reference only.");
    expect(gateway.comments[0]?.body).not.toContain("免责声明");
    expect(capturedContext?.fullName).toBe("octo/repo");
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
    expect(gateway.comments).toHaveLength(1);
    expect(gateway.comments[0]?.body).toContain("issue-bot:similar-issues");
    expect(gateway.comments[0]?.body).toContain("#9");
    expect(gateway.comments.some((comment) => comment.body.includes("AI Guidance"))).toBe(false);
  });

  it("skips AI help when provider request fails", async () => {
    const config = createConfig();
    config.issues.aiHelp.enabled = true;
    const issue = createIssue({
      title: "Plugin crash after startup",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Paper 1.21 / Java 21",
        "",
        "## Steps to Reproduce",
        "Start the server and wait for the crash",
        "",
        "## Expected Behavior",
        "The plugin should keep running"
      ].join("\n")
    });
    const gateway = new FakeGateway(issue);
    const provider = {
      async generateHelp() {
        throw new Error("Invalid API key");
      },
      async reviewDuplicate() {
        return {
          duplicate: false,
          confidence: 0.2,
          reason: ""
        };
      }
    } as unknown as OpenAiCompatibleProvider;

    await expect(runIssueWorkflow({
      issue,
      config,
      gateway,
      provider
    })).resolves.toBeUndefined();

    expect(issue.labels).toContain("needs-ai-help");
    expect(gateway.comments.some((comment) => comment.body.includes("AI Guidance"))).toBe(false);
  });
});
