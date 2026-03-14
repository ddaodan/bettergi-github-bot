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
        "## 环境信息",
        "Windows",
        "",
        "## 复现步骤",
        "请填写"
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh"
    });

    expect(result.valid).toBe(false);
    expect(result.missingSections.map((item) => item.id)).toContain("steps");
    expect(result.commentBody).toContain("模板检查结果");
  });

  it("passes valid issue body", () => {
    const config = createConfig();
    const result = validateIssue({
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## 环境信息",
        "Windows",
        "",
        "## 复现步骤",
        "1. 打开插件",
        "",
        "## 预期行为",
        "正常工作"
      ].join("\n"),
      config: config.issues.validation,
      commentMode: "zh"
    });

    expect(result.valid).toBe(true);
    expect(result.desiredLabels).toContain("type:bug");
  });

  it("accepts English section headings", () => {
    const config = createConfig();
    const result = validateIssue({
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
  });
});
