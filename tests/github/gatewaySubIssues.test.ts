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
});
