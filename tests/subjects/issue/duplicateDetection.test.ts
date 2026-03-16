import { describe, expect, it, vi } from "vitest";

import { chooseCanonicalIssue, detectDuplicate } from "../../../src/subjects/issue/duplicateDetection.js";
import { parseIssueBody } from "../../../src/subjects/issue/parser.js";
import { createConfig, createIssue } from "../../helpers/fixtures.js";

describe("duplicate detection", () => {
  it("prefers earliest open issue as canonical", () => {
    const canonical = chooseCanonicalIssue([
      {
        number: 12,
        title: "old closed",
        body: "",
        labels: [],
        state: "closed",
        htmlUrl: "https://example.test/issues/12",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z"
      },
      {
        number: 8,
        title: "older open",
        body: "",
        labels: [],
        state: "open",
        htmlUrl: "https://example.test/issues/8",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z"
      }
    ]);

    expect(canonical?.number).toBe(8);
  });

  it("closes exact duplicate without AI", async () => {
    const config = createConfig();
    const issue = createIssue();
    const candidate = {
      number: 5,
      title: issue.title,
      body: issue.body,
      labels: [],
      state: "open" as const,
      htmlUrl: "https://example.test/issues/5",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z"
    };

    const addDuplicateLabel = vi.fn();
    const addDuplicateComment = vi.fn();
    const closeIssue = vi.fn();

    const result = await detectDuplicate({
      issue,
      parsed: parseIssueBody(issue.body),
      config: config.issues.validation.duplicateDetection,
      commentMode: "zh",
      searchIssues: async () => [candidate],
      addDuplicateComment,
      addDuplicateLabel,
      closeIssue
    });

    expect(result.duplicateOf?.number).toBe(5);
    expect(addDuplicateLabel).toHaveBeenCalledWith(["duplicate"]);
    expect(addDuplicateComment).toHaveBeenCalledOnce();
    expect(closeIssue).toHaveBeenCalledOnce();
  });

  it("returns similar issue suggestions when score is below duplicate threshold", async () => {
    const config = createConfig();
    const issue = createIssue({
      title: "[bug] 一条龙设置无法保存",
      body: [
        "## 系统环境",
        "Windows 11",
        "",
        "## BetterGI 版本号",
        "0.58.0",
        "",
        "## 问题描述",
        "一条龙相关的任何配置都没法保存",
        "",
        "## 复现步骤",
        "打开一条龙界面后保存失败"
      ].join("\n")
    });
    const candidate = {
      number: 17,
      title: "[bug] 一条龙设置保存失败，读取配置组失败，脚本读取失败",
      body: [
        "## 系统环境",
        "win11",
        "",
        "## BetterGI 版本号",
        "0.58.0",
        "",
        "## 问题描述",
        "一条龙设置保存失败，读取配置组失败，脚本读取失败",
        "",
        "## 复现步骤",
        "打开对应界面，更改配置时会出现"
      ].join("\n"),
      labels: ["bug"],
      state: "open" as const,
      htmlUrl: "https://example.test/issues/17",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z"
    };

    const result = await detectDuplicate({
      issue,
      parsed: parseIssueBody(issue.body),
      config: config.issues.validation.duplicateDetection,
      commentMode: "zh",
      searchIssues: async () => [candidate],
      addDuplicateComment: async () => undefined,
      addDuplicateLabel: async () => undefined,
      closeIssue: async () => undefined
    });

    expect(result.duplicateOf).toBeUndefined();
    expect(result.similarIssues?.[0]?.candidate.number).toBe(17);
    expect(result.similarIssues?.[0]?.score).toBeGreaterThanOrEqual(0.3);
  });
});
