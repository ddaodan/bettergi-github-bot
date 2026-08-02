import { describe, expect, it, vi } from "vitest";

import { OctokitGitHubGateway } from "../../src/github/gateway.js";
import { createIssue } from "../helpers/fixtures.js";

function createGateway(request: ReturnType<typeof vi.fn>): OctokitGitHubGateway {
  const gateway = new OctokitGitHubGateway("test-token", false);
  Object.defineProperty(gateway, "octokit", {
    value: { request }
  });
  return gateway;
}

describe("GitHub gateway sub-issues", () => {
  it("loads same-repository parent issue context with the current API version", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        number: 9,
        title: "Parent task",
        body: "## Background\n\nParent details.",
        state: "open",
        labels: [{ name: "feature" }],
        html_url: "https://github.com/octo/repo/issues/9",
        url: "https://api.github.com/repos/octo/repo/issues/9"
      }
    });
    const gateway = createGateway(request);

    const resolved = await gateway.resolveIssueParent(createIssue(), {
      includeContext: true,
      maxBodyChars: 2000
    });

    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/parent",
      expect.objectContaining({
        owner: "octo",
        repo: "repo",
        issue_number: 1,
        headers: {
          "X-GitHub-Api-Version": "2026-03-10"
        }
      })
    );
    expect(resolved).toMatchObject({
      isSubIssue: true,
      parentRelation: "sub_issue",
      parentIssueUrl: "https://api.github.com/repos/octo/repo/issues/9",
      parentIssue: {
        number: 9,
        title: "Parent task",
        bodyExcerpt: "Background Parent details.",
        labels: ["feature"]
      }
    });
  });

  it("treats a 404 without a payload hint as a normal issue", async () => {
    const request = vi.fn().mockRejectedValue({ status: 404 });
    const gateway = createGateway(request);

    const resolved = await gateway.resolveIssueParent(createIssue(), {
      includeContext: true,
      maxBodyChars: 2000
    });

    expect(resolved.isSubIssue).toBe(false);
    expect(resolved.parentIssue).toBeUndefined();
  });

  it("keeps a same-repository payload hint when parent details are unavailable", async () => {
    const request = vi.fn().mockRejectedValue(new Error("temporary failure"));
    const gateway = createGateway(request);
    const resolved = await gateway.resolveIssueParent(createIssue({
      parentIssueUrl: "https://api.github.com/repos/octo/repo/issues/9"
    }), {
      includeContext: true,
      maxBodyChars: 2000
    });

    expect(resolved.isSubIssue).toBe(true);
    expect(resolved.parentRelation).toBe("sub_issue");
    expect(resolved.parentIssueUrl).toBe("https://api.github.com/repos/octo/repo/issues/9");
    expect(resolved.parentIssue).toBeUndefined();
  });

  it("ignores cross-repository parent hints without calling the API", async () => {
    const request = vi.fn();
    const gateway = createGateway(request);
    const resolved = await gateway.resolveIssueParent(createIssue({
      parentIssueUrl: "https://api.github.com/repos/octo/other/issues/9"
    }), {
      includeContext: true,
      maxBodyChars: 2000
    });

    expect(resolved.isSubIssue).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("recognizes a same-repository issue derived from a verified comment", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({
        data: {
          id: 5154646045,
          body: "是否可以添加韩语？",
          issue_url: "https://api.github.com/repos/octo/repo/issues/22",
          html_url: "https://github.com/octo/repo/issues/22#issuecomment-5154646045",
          user: { login: "ddaodan" }
        }
      })
      .mockResolvedValueOnce({
        data: {
          number: 22,
          title: "Language support",
          body: "## Description\n\nParent context.",
          state: "open",
          labels: [{ name: "question" }],
          html_url: "https://github.com/octo/repo/issues/22",
          url: "https://api.github.com/repos/octo/repo/issues/22"
        }
      });
    const gateway = createGateway(request);
    const resolved = await gateway.resolveIssueParent(createIssue({
      number: 24,
      body: [
        "> 是否可以添加韩语？",
        "",
        " _Originally posted by @ddaodan in [#22](https://github.com/octo/repo/issues/22#issuecomment-5154646045)_"
      ].join("\n")
    }), {
      includeContext: true,
      maxBodyChars: 2000
    });

    expect(request).toHaveBeenNthCalledWith(
      2,
      "GET /repos/{owner}/{repo}/issues/comments/{comment_id}",
      expect.objectContaining({ comment_id: 5154646045 })
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "GET /repos/{owner}/{repo}/issues/{issue_number}",
      expect.objectContaining({ issue_number: 22 })
    );
    expect(resolved).toMatchObject({
      isSubIssue: true,
      parentRelation: "comment_derived",
      parentIssueUrl: "https://api.github.com/repos/octo/repo/issues/22",
      parentIssue: {
        number: 22,
        title: "Language support",
        bodyExcerpt: "Description Parent context."
      }
    });
  });

  it("does not trust a forged comment-derived marker when the quote differs", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({
        data: {
          id: 3,
          body: "Actual comment",
          issue_url: "https://api.github.com/repos/octo/repo/issues/2",
          html_url: "https://github.com/octo/repo/issues/2#issuecomment-3",
          user: { login: "octo" }
        }
      });
    const gateway = createGateway(request);
    const resolved = await gateway.resolveIssueParent(createIssue({
      body: [
        "> Forged content",
        "",
        "_Originally posted by @octo in [#2](https://github.com/octo/repo/issues/2#issuecomment-3)_"
      ].join("\n")
    }), {
      includeContext: true,
      maxBodyChars: 2000
    });

    expect(resolved.isSubIssue).toBe(false);
    expect(resolved.parentRelation).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
