import { describe, expect, it } from "vitest";

import { validateIssue } from "../../../src/subjects/issue/validation.js";
import { createConfig } from "../../helpers/fixtures.js";

describe("validateIssue", () => {
  it("reports missing required sections", () => {
    const config = createConfig();
    const result = validateIssue({
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows",
        "",
        "## Steps to Reproduce",
        "Please fill"
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh"
    });

    expect(result.valid).toBe(false);
    expect(result.missingSections.map((item) => item.id)).toContain("steps");
    expect(result.commentBody).toContain("模板检查结果");
  });

  it("uses the auto-close wording when auto-close is enabled", () => {
    const config = createConfig();
    config.issues.validation.autoClose.enabled = true;
    const result = validateIssue({
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows",
        "",
        "## Steps to Reproduce",
        "Please fill"
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh"
    });

    expect(result.valid).toBe(false);
    expect(result.commentBody).toContain("已自动关闭");
    expect(result.commentBody).toContain("请直接编辑此 Issue 并按模板补全上述内容");
  });

  it("does not emit a validation comment for valid issues", () => {
    const config = createConfig();
    const result = validateIssue({
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows",
        "",
        "## Steps to Reproduce",
        "1. Open the plugin",
        "",
        "## Expected Behavior",
        "Should work normally"
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh"
    });

    expect(result.valid).toBe(true);
    expect(result.desiredLabels).toContain("BUG");
    expect(result.commentBody).toBeUndefined();
  });

  it("accepts English section headings", () => {
    const config = createConfig();
    const result = validateIssue({
      title: "[bug] Crash after startup",
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
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh-en"
    });

    expect(Object.keys(result.parsed.sections)).toContain("steps to reproduce");
    expect(result.missingSections.map((item) => item.id)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.commentBody).toBeUndefined();
  });

  it("matches issue forms by title prefix even without the legacy marker", () => {
    const config = createConfig();
    const result = validateIssue({
      title: "[bug] Crash after startup",
      body: [
        "## Environment",
        "Paper 1.21 / Java 21",
        "",
        "## Steps to Reproduce",
        "1. Start the server",
        "2. Load the plugin and wait for crash",
        "",
        "## Expected Behavior",
        "The plugin should boot successfully without crash"
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh-en"
    });

    expect(result.template?.key).toBe("bug");
    expect(result.valid).toBe(true);
    expect(result.commentBody).toBeUndefined();
  });
});
