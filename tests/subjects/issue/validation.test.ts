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

  it("uses the auto-close wording only when no template is detected", () => {    const config = createConfig();
    config.issues.validation.autoClose.enabled = true;
    const noTemplateResult = validateIssue({
      body: "这个插件用不了，快点修复！！",
      config: config.issues.validation,
      commentMode: "zh"
    });

    expect(noTemplateResult.valid).toBe(false);
    expect(noTemplateResult.templateMatched).toBe(false);
    expect(noTemplateResult.commentBody).toContain("已自动关闭");
    expect(noTemplateResult.commentBody).toContain("请直接编辑此 Issue 并按模板补全上述内容");

    const templateMatchedResult = validateIssue({
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

    expect(templateMatchedResult.valid).toBe(false);
    expect(templateMatchedResult.templateMatched).toBe(true);
    expect(templateMatchedResult.commentBody).toContain("请补充以下必填内容");
    expect(templateMatchedResult.commentBody).not.toContain("已自动关闭");
  });

  it("waives transfer-exempt sections for transferred issues", () => {
    const config = createConfig();
    config.issues.validation.templates[0]?.requiredSections.push({
      id: "script-name",
      aliases: ["相关脚本名称与版本"],
      transferExempt: true
    });
    const body = [
      "<!-- issue-template: bug -->",
      "",
      "## Environment",
      "Windows 11",
      "",
      "## Steps to Reproduce",
      "1. Start the plugin",
      "",
      "## Expected Behavior",
      "The plugin should keep running"
    ].join("\n");

    const nativeResult = validateIssue({
      body,
      config: config.issues.validation,
      commentMode: "zh"
    });
    expect(nativeResult.valid).toBe(false);
    expect(nativeResult.missingSections.map((item) => item.id)).toEqual(["script-name"]);

    const transferredResult = validateIssue({
      body,
      config: config.issues.validation,
      commentMode: "zh",
      transferred: true
    });
    expect(transferredResult.valid).toBe(true);
    expect(transferredResult.commentBody).toBeUndefined();
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

  it("rejects title prefix and section matches when the configured form signature is missing", () => {
    const config = createConfig();
    config.issues.validation.templates[0]!.detect.formSignatures = ["我已搜索现有 Issue，确认没有相同问题"];

    const result = validateIssue({
      title: "[bug] 手写的伪模板",
      body: [
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "1. 打开 BetterGI",
        "",
        "## Expected Behavior",
        "正常启动"
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh"
    });

    expect(result.templateMatched).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.commentBody).toContain("未找到可用模板");
  });

  it("accepts the same body once the form signature is present", () => {
    const config = createConfig();
    config.issues.validation.templates[0]!.detect.formSignatures = ["我已搜索现有 Issue，确认没有相同问题"];

    const result = validateIssue({
      title: "[bug] 通过表单提交",
      body: [
        "### 提交确认 / Checklist",
        "",
        "- [x] 我已搜索现有 Issue，确认没有相同问题",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "1. 打开 BetterGI",
        "",
        "## Expected Behavior",
        "正常启动"
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh"
    });

    expect(result.templateMatched).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.commentBody).toBeUndefined();
  });

  it("trusts an explicit hidden template marker even without a form signature", () => {
    const config = createConfig();
    config.issues.validation.templates[0]!.detect.formSignatures = ["我已搜索现有 Issue，确认没有相同问题"];

    const result = validateIssue({
      title: "[bug] 带隐藏标记",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "1. 打开 BetterGI",
        "",
        "## Expected Behavior",
        "正常启动"
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh"
    });

    expect(result.templateMatched).toBe(true);
    expect(result.valid).toBe(true);
  });
});
