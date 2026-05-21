import { describe, expect, it } from "vitest";

import { buildSearchIssueQuery } from "../../src/github/gateway.js";

describe("github gateway duplicate search limits", () => {
  it("trims search queries to GitHub's boolean operator limit", () => {
    const result = buildSearchIssueQuery({
      owner: "babalae",
      repo: "better-genshin-impact",
      terms: [
        "term 1",
        "term 2",
        "term 3",
        "term 4",
        "term 5",
        "term 6",
        "term 7",
        "term 8"
      ]
    });

    expect(result.includedTerms).toHaveLength(6);
    expect(result.skippedTerms).toEqual(["\"term 7\"", "\"term 8\""]);
    expect(result.query.match(/\bOR\b/g)).toHaveLength(5);
  });
});
