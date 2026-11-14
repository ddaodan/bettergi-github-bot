import { describe, expect, it, vi } from "vitest";

import type { PullRequestContext } from "../../../src/core/types.js";
import { resolvePullRequestWorkflowTrigger, runPullRequestWorkflow } from "../../../src/subjects/pullRequest/run.js";
import { createConfig, createIssue, FakeGateway } from "../../helpers/fixtures.js";

function createPullRequest(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    kind: "pull_request",
    owner: "octo",
    repo: "repo",
    number: 10,
    title: "Add a new script",
    body: "Some description",
    state: "open",
    labels: [],
    htmlUrl: "https://github.com/octo/repo/pull/10",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    action: "opened",
    actorLogin: "contributor",
    actorType: "User",
    isDraft: false,
    merged: false,
    baseBranch: "main",
    headBranch: "feature",
    ...overrides
  };
}

function createGateway(pullRequest: PullRequestContext): FakeGateway {
  const gateway = new FakeGateway(createIssue());
  gateway.pullRequest = pullRequest;
  return gateway;
}

function enableScriptsListConfig(config = createConfig()) {
  config.pullRequests.pathLabels = {
    enabled: true,
    managed: true,
    rules: [
      { label: "JS 脚本", pathPrefixes: ["repo/js"], requireSubdirectory: true },
      { label: "地图追踪", pathPrefixes: ["repo/pathing"] },
      { label: "战斗策略", pathPrefixes: ["repo/combat"] },
      { label: "七圣召唤", pathPrefixes: ["repo/tcg"] }
    ],
    documentationLabel: "documentation",
    unmatchedLabel: "",
    commentAnchor: "pull-bot:path-labels"
  };
  config.pullRequests.locationCheck = {
    enabled: true,
    commentAnchor: "pull-bot:location",
    allowedPaths: ["build", ".github"],
    scriptRoots: ["repo/js"],
    fileKindRules: [{ category: "策略文件", expectedLocations: ["repo/combat", "repo/tcg"], extensions: [".txt"] }],
    rules: {
      pathingFileNamePattern: "^\\d{2,3}-",
      pathingRequireReadme: false,
      jsFolderNameNoSpace: false,
      jsFolderNamePattern: ""
    }
  };
  return config;
}

describe("resolvePullRequestWorkflowTrigger", () => {
  it("handles opened, reopened and edited actions", () => {
    for (const action of ["opened", "reopened", "edited"]) {
      expect(resolvePullRequestWorkflowTrigger(action), action).toBe("pull_request_opened");
    }
  });

  it("handles synchronize and ready_for_review actions", () => {
    for (const action of ["synchronize", "ready_for_review"]) {
      expect(resolvePullRequestWorkflowTrigger(action), action).toBe("pull_request_synchronize");
    }
  });

  it("ignores unrelated actions", () => {
    expect(resolvePullRequestWorkflowTrigger("labeled")).toBeUndefined();
    expect(resolvePullRequestWorkflowTrigger("closed")).toBeUndefined();
  });
});

describe("runPullRequestWorkflow - path labels", () => {
  it("labels a pathing pull request and ignores pathing assets inside scripts", async () => {
    const pullRequest = createPullRequest();
    const gateway = createGateway(pullRequest);
    gateway.pullRequestFiles = [
      { filename: "repo/pathing/矿物/01-水晶块.json", status: "added", additions: 10, deletions: 0 }
    ];
    const config = enableScriptsListConfig();

    await runPullRequestWorkflow({
      pullRequest,
      trigger: "pull_request_opened",
      config,
      gateway,
      commentMode: "zh"
    });

    expect(gateway.addedLabels).toContain("地图追踪");
    expect(gateway.addedLabels).not.toContain("JS 脚本");
  });

  it("removes stale labels when files change", async () => {
    const pullRequest = createPullRequest({ labels: ["七圣召唤"], action: "synchronize" });
    const gateway = createGateway(pullRequest);
    gateway.pullRequestFiles = [
      { filename: "repo/combat/team.txt", status: "added", additions: 5, deletions: 0 }
    ];
    const config = enableScriptsListConfig();

    await runPullRequestWorkflow({
      pullRequest,
      trigger: "pull_request_synchronize",
      config,
      gateway,
      commentMode: "zh"
    });

    expect(gateway.addedLabels).toContain("战斗策略");
    expect(gateway.removedLabels).toContain("七圣召唤");
  });

  it("skips draft pull requests", async () => {
    const pullRequest = createPullRequest({ isDraft: true });
    const gateway = createGateway(pullRequest);
    gateway.pullRequestFiles = [
      { filename: "repo/js/Demo/main.js", status: "added", additions: 1, deletions: 0 }
    ];
    const config = enableScriptsListConfig();

    await runPullRequestWorkflow({
      pullRequest,
      trigger: "pull_request_opened",
      config,
      gateway,
      commentMode: "zh"
    });

    expect(gateway.addedLabels).toEqual([]);
    expect(gateway.comments).toEqual([]);
  });
});

describe("runPullRequestWorkflow - location check", () => {
  it("posts an advisory comment when files are misplaced", async () => {
    const pullRequest = createPullRequest();
    const gateway = createGateway(pullRequest);
    gateway.pullRequestFiles = [
      { filename: "scripts/main.js", status: "added", additions: 3, deletions: 0 }
    ];
    const config = enableScriptsListConfig();

    await runPullRequestWorkflow({
      pullRequest,
      trigger: "pull_request_opened",
      config,
      gateway,
      commentMode: "zh"
    });

    const comment = gateway.comments.find((item) => item.body.includes("pull-bot:location"));
    expect(comment?.body).toContain("scripts/main.js");
    expect(comment?.body).toContain("repo/js");
  });

  it("reports and does not label a stray file in the script root (#3774)", async () => {
    const pullRequest = createPullRequest({ title: "测试一下" });
    const gateway = createGateway(pullRequest);
    gateway.pullRequestFiles = [
      { filename: "repo/js/起风了.json", status: "added", additions: 13, deletions: 0 }
    ];
    const config = enableScriptsListConfig();

    await runPullRequestWorkflow({
      pullRequest,
      trigger: "pull_request_opened",
      config,
      gateway,
      commentMode: "zh"
    });

    const comment = gateway.comments.find((item) => item.body.includes("pull-bot:location"));
    expect(comment?.body).toContain("repo/js/起风了.json");
    expect(comment?.body).toContain("repo/js/<脚本名>/");
    expect(gateway.addedLabels).not.toContain("JS 脚本");
  });

  it("removes the comment once files are correctly placed", async () => {
    const pullRequest = createPullRequest({ action: "synchronize" });
    const gateway = createGateway(pullRequest);
    gateway.pullRequestFiles = [
      { filename: "repo/js/Demo/main.js", status: "added", additions: 3, deletions: 0 }
    ];
    gateway.comments.push({ id: 99, issueNumber: pullRequest.number, body: "<!-- pull-bot:location -->\nold" });
    const config = enableScriptsListConfig();

    await runPullRequestWorkflow({
      pullRequest,
      trigger: "pull_request_synchronize",
      config,
      gateway,
      commentMode: "zh"
    });

    expect(gateway.deletedCommentIds).toContain(99);
  });
});

describe("runPullRequestWorkflow - issue references are passive", () => {
  it.each(["pull_request_opened", "pull_request_synchronize"] as const)(
    "does not modify issue references or post a summary on %s",
    async (trigger) => {
      const body = [
        "<!-- 例：close #1234 / Fixes #1234 -->",
        "Related to #42",
        "Fixes #581",
        "Fixes #2137"
      ].join("\n");
      const pullRequest = createPullRequest({ title: "Improve launcher #42", body });
      const gateway = createGateway(pullRequest);
      // Tripwires also guard against accidentally restoring the removed API calls.
      const updatePullRequestBody = vi.fn();
      const getIssueStateForRepository = vi.fn();
      Object.assign(gateway, { updatePullRequestBody, getIssueStateForRepository });
      const config = enableScriptsListConfig();
      gateway.pullRequestFiles = [
        { filename: "repo/js/Demo/main.js", status: "added", additions: 3, deletions: 0 }
      ];

      await runPullRequestWorkflow({
        pullRequest,
        trigger,
        config,
        gateway,
        commentMode: "zh"
      });

      expect(pullRequest.body).toBe(body);
      expect(updatePullRequestBody).not.toHaveBeenCalled();
      expect(getIssueStateForRepository).not.toHaveBeenCalled();
      expect(gateway.comments).toEqual([]);
      expect(gateway.closedIssues).toEqual([]);
      expect(gateway.addedLabels).toContain("JS 脚本");
    }
  );
});
