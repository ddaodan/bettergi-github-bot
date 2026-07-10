import { describe, expect, it, vi } from "vitest";

import type { OpenAiCompatibleProvider } from "../../../src/providers/openaiCompatible/client.js";
import {
  buildLocalIssueTitle,
  isPlaceholderIssueTitle,
  maybeUpdateIssueTitle,
  shouldReviewTitleMismatch
} from "../../../src/subjects/issue/titleGeneration.js";
import { validateIssue } from "../../../src/subjects/issue/validation.js";
import { createConfig, createIssue, FakeGateway } from "../../helpers/fixtures.js";

function createValidDescriptionIssue(title: string) {
  return createIssue({
    title,
    body: [
      "<!-- issue-template: bug -->",
      "",
      "## Description",
      "保存配置后程序立即崩溃，重新启动后配置也没有保留。",
      "",
      "## Environment",
      "Windows 11 / Java 21",
      "",
      "## Steps to Reproduce",
      "打开设置并保存配置",
      "",
      "## Expected Behavior",
      "配置应正常保存"
    ].join("\n")
  });
}

function validate(issue: ReturnType<typeof createIssue>) {
  const config = createConfig();
  return {
    config,
    validation: validateIssue({
      title: issue.title,
      body: issue.body,
      config: config.issues.validation,
      commentMode: "zh"
    })
  };
}

describe("issue title generation", () => {
  it("recognizes a template prefix without user content as a placeholder", () => {
    expect(isPlaceholderIssueTitle({
      title: "[bug] ",
      prefixes: ["[bug]"],
      placeholderTitles: ["bug", "问题"]
    })).toBe(true);
  });

  it("builds a local fallback title from the descriptive section", () => {
    const issue = createValidDescriptionIssue("[bug]");
    const { config, validation } = validate(issue);

    expect(buildLocalIssueTitle({
      currentTitle: issue.title,
      validation,
      config: config.issues.titleGeneration
    })).toBe("[bug] 保存配置后程序立即崩溃，重新启动后配置也没有保留。");
  });

  it("updates a placeholder title with an AI suggestion", async () => {
    const issue = createValidDescriptionIssue("[bug]");
    const { config, validation } = validate(issue);
    const gateway = new FakeGateway(issue);
    const provider = {
      async suggestIssueTitle() {
        return {
          shouldReplace: true,
          confidence: 0.99,
          title: "保存配置后程序崩溃",
          reason: "The current title is only the template prefix."
        };
      }
    } as unknown as OpenAiCompatibleProvider;

    await maybeUpdateIssueTitle({
      issue,
      validation,
      config: config.issues.titleGeneration,
      gateway,
      provider
    });

    expect(issue.title).toBe("[bug] 保存配置后程序崩溃");
    expect(gateway.updatedTitles).toEqual(["[bug] 保存配置后程序崩溃"]);
  });

  it("requires a high-confidence AI decision before replacing an unrelated title", async () => {
    const issue = createValidDescriptionIssue("[bug] 无法登录账号");
    const { config, validation } = validate(issue);
    const gateway = new FakeGateway(issue);
    const suggestIssueTitle = vi.fn(async () => ({
      shouldReplace: true,
      confidence: 0.7,
      title: "保存配置后程序崩溃",
      reason: "The title appears unrelated."
    }));
    const provider = { suggestIssueTitle } as unknown as OpenAiCompatibleProvider;

    expect(shouldReviewTitleMismatch({
      title: issue.title,
      prefixes: ["[bug]"],
      evidence: validation.parsed.sections.description ?? ""
    })).toBe(true);

    await maybeUpdateIssueTitle({
      issue,
      validation,
      config: config.issues.titleGeneration,
      gateway,
      provider
    });

    expect(suggestIssueTitle).toHaveBeenCalledOnce();
    expect(gateway.updatedTitles).toHaveLength(0);
    expect(issue.title).toBe("[bug] 无法登录账号");
  });

  it("does not change a title when template validation fails", async () => {
    const issue = createIssue({
      title: "[bug]",
      body: "## Environment\nWindows 11"
    });
    const { config, validation } = validate(issue);
    const gateway = new FakeGateway(issue);

    await maybeUpdateIssueTitle({
      issue,
      validation,
      config: config.issues.titleGeneration,
      gateway
    });

    expect(validation.valid).toBe(false);
    expect(gateway.updatedTitles).toHaveLength(0);
  });
});
