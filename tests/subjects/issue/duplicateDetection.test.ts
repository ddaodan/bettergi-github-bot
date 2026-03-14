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
});
