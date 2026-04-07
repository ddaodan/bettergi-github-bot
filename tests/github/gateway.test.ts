import { describe, expect, it } from "vitest";

import {
  buildSearchIssueQuery,
  normalizeLabelName,
  normalizeSearchIssueTerm
} from "../../src/github/gateway.js";

describe("github gateway search query", () => {
  it("filters placeholder duplicate-search terms", () => {
    expect(normalizeSearchIssueTerm("  execute   command  ")).toBe("\"execute command\"");
    expect(normalizeSearchIssueTerm("no response")).toBe("");
  });

  it("trims search queries to the GitHub Search API length limit", () => {
    const result = buildSearchIssueQuery({
      owner: "babalae",
      repo: "better-genshin-impact",
      terms: [
        "one dragon complete action execute command",
        "allow adding an execute command action after one dragon completes so a batch script can continue the rest of the workflow",
        "the computer also runs other automation software and should report completion to those systems after the task is finished",
        "no response",
        "one dragon complete action",
        "execute command",
        "automation notification"
      ]
    });

    expect(result.query.length).toBeLessThanOrEqual(256);
    expect(result.includedTerms).toContain("\"one dragon complete action execute command\"");
    expect(result.includedTerms).toContain("\"one dragon complete action\"");
    expect(result.includedTerms.length).toBeGreaterThanOrEqual(2);
    expect(result.skippedTerms.length).toBeGreaterThan(0);
    expect(result.query).not.toContain("no response");
  });

  it("falls back to the repository issue scope when all terms are filtered out", () => {
    const result = buildSearchIssueQuery({
      owner: "babalae",
      repo: "better-genshin-impact",
      terms: [
        "",
        "   ",
        "no response"
      ]
    });

    expect(result.includedTerms).toEqual([]);
    expect(result.query).toBe("repo:babalae/better-genshin-impact is:issue");
  });

  it("normalizes label names case-insensitively for existence checks", () => {
    expect(normalizeLabelName("BUG")).toBe("bug");
    expect(normalizeLabelName(" bug ")).toBe("bug");
    expect(normalizeLabelName("功能建议")).toBe("功能建议");
    expect(normalizeLabelName(undefined)).toBe("");
  });
});
