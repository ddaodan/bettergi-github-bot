import { describe, expect, it } from "vitest";

import {
  createIssueBodyExcerpt,
  isSameRepository,
  matchesCommentDerivedIssueBody,
  parseCommentDerivedIssueBody,
  parseGitHubIssueUrl
} from "../../src/github/issueRelations.js";

describe("GitHub issue relations", () => {
  it("parses API and HTML issue URLs", () => {
    expect(parseGitHubIssueUrl("https://api.github.com/repos/octo/repo/issues/12")).toEqual({
      owner: "octo",
      repo: "repo",
      number: 12,
      apiUrl: "https://api.github.com/repos/octo/repo/issues/12",
      htmlUrl: "https://github.com/octo/repo/issues/12"
    });
    expect(parseGitHubIssueUrl("https://github.com/octo/repo/issues/12")?.number).toBe(12);
    expect(parseGitHubIssueUrl("https://attacker.example/octo/repo/issues/12")).toBeUndefined();
  });

  it("matches repository coordinates case-insensitively", () => {
    const coordinates = parseGitHubIssueUrl("https://api.github.com/repos/Octo/Repo/issues/12");
    expect(coordinates && isSameRepository(coordinates, "octo", "repo")).toBe(true);
    expect(coordinates && isSameRepository(coordinates, "octo", "other")).toBe(false);
  });

  it("normalizes and truncates parent issue bodies", () => {
    const excerpt = createIssueBodyExcerpt([
      "<!-- hidden marker -->",
      "## Background",
      "",
      "```text",
      "stack trace line",
      "```",
      "",
      "- The parent task contains **important** context.",
      "- [Project docs](https://example.test/docs)",
      "- Additional details make this excerpt long enough to be truncated."
    ].join("\n"), 70);

    expect(excerpt).not.toContain("hidden marker");
    expect(excerpt).not.toContain("https://example.test");
    expect(excerpt).toContain("Background");
    expect(excerpt).toContain("stack trace");
    expect(excerpt.length).toBeLessThanOrEqual(70);
    expect(excerpt.endsWith("...")).toBe(true);
  });

  it("parses GitHub-generated issues derived from comments", () => {
    const reference = parseCommentDerivedIssueBody([
      "> 是否可以添加韩语？",
      "",
      " _Originally posted by @ddaodan in [#22](https://github.com/ddaodan/better-genshin-impact/issues/22#issuecomment-5154646045)_"
    ].join("\n"));

    expect(reference).toMatchObject({
      owner: "ddaodan",
      repo: "better-genshin-impact",
      number: 22,
      commentId: 5154646045,
      authorLogin: "ddaodan",
      quotedBody: "是否可以添加韩语？"
    });
    expect(reference && matchesCommentDerivedIssueBody(reference, "是否可以添加韩语？")).toBe(true);
    expect(reference && matchesCommentDerivedIssueBody(reference, "不同内容")).toBe(false);
  });

  it("rejects edited or malformed comment-derived markers", () => {
    expect(parseCommentDerivedIssueBody([
      "> Original comment",
      "Unquoted extra content",
      "",
      "_Originally posted by @octo in [#2](https://github.com/octo/repo/issues/2#issuecomment-3)_"
    ].join("\n"))).toBeUndefined();
    expect(parseCommentDerivedIssueBody([
      "> Original comment",
      "",
      "_Originally posted by @octo in [#3](https://github.com/octo/repo/issues/2#issuecomment-3)_"
    ].join("\n"))).toBeUndefined();
  });
});
