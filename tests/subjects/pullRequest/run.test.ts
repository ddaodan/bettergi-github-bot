import { describe, expect, it } from "vitest";

import type { PullRequestContext } from "../../../src/core/types.js";
import { runPullRequestWorkflow } from "../../../src/subjects/pullRequest/run.js";
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
      { label: "JS 脚本", pathPrefixes: ["repo/js"] },
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
    fileKindRules: [{ category: "战斗策略", expectedLocation: "repo/combat", extensions: [".txt"] }],
    rules: {
      pathingFileNamePattern: "^\\d{2,3}-",
      pathingRequireReadme: false,
      jsFolderNameNoSpace: false,
      jsFolderNamePattern: ""
    }
  };
  return config;
}

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

describe("runPullRequestWorkflow - issue link", () => {
  function enableIssueLink(config = createConfig()) {
    config.pullRequests.issueLink = {
      enabled: true,
      commentAnchor: "pull-bot:issue-link",
      appendCloseKeyword: true,
      closeKeywordTemplate: "close #{number}",
      linkedLabel: "",
      requireSameRepository: true
    };
    return config;
  }

  it("appends a close keyword for an open issue referenced without one", async () => {
    const pullRequest = createPullRequest({
      title: "Improve launcher",
      body: "This should address the crash in #42"
    });
    const gateway = createGateway(pullRequest);
    gateway.repositoryIssues.set("octo/repo#42", {
      number: 42,
      title: "Launcher crash",
      state: "open",
      htmlUrl: "https://github.com/octo/repo/issues/42"
    });
    const config = enableIssueLink();

    await runPullRequestWorkflow({
      pullRequest,
      trigger: "pull_request_opened",
      config,
      gateway,
      commentMode: "zh"
    });

    expect(gateway.pullRequestBodyUpdates).toHaveLength(1);
    expect(gateway.pullRequestBodyUpdates[0]?.body).toContain("close #42");
    expect(gateway.comments.some((item) => item.body.includes("pull-bot:issue-link"))).toBe(true);
  });

  it("does not append keywords for closed or missing issues", async () => {
    const pullRequest = createPullRequest({ body: "related to #7 and #8" });
    const gateway = createGateway(pullRequest);
    gateway.repositoryIssues.set("octo/repo#7", {
      number: 7,
      title: "Closed one",
      state: "closed",
      htmlUrl: "https://github.com/octo/repo/issues/7"
    });
    const config = enableIssueLink();

    await runPullRequestWorkflow({
      pullRequest,
      trigger: "pull_request_opened",
      config,
      gateway,
      commentMode: "zh"
    });

    expect(gateway.pullRequestBodyUpdates).toEqual([]);
  });

  it("does nothing when the issue link feature is disabled", async () => {
    const pullRequest = createPullRequest({ body: "fixes #42" });
    const gateway = createGateway(pullRequest);
    const config = createConfig();

    await runPullRequestWorkflow({
      pullRequest,
      trigger: "pull_request_opened",
      config,
      gateway,
      commentMode: "zh"
    });

    expect(gateway.pullRequestBodyUpdates).toEqual([]);
    expect(gateway.comments).toEqual([]);
  });
});
