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
    expect(result.desiredLabels).toContain("type:bug");
    expect(result.commentBody).toBeUndefined();
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
    expect(result.commentBody).toBeUndefined();
  });
});
