import { describe, expect, it } from "vitest";

import {
  createRelaxedSubIssueValidation,
  isDirectIssueRelation,
  resolveSubIssueProcessingMode
} from "../../../src/subjects/issue/subIssues.js";
import { createConfig, createIssue } from "../../helpers/fixtures.js";

describe("sub-issue helpers", () => {
  it("uses relaxed mode for manual refresh when automatic processing is skipped", () => {
    const issue = createIssue({ isSubIssue: true });
    expect(resolveSubIssueProcessingMode({
      issue,
      trigger: "issue_opened",
      configuredMode: "skip"
    })).toBe("skip");
    expect(resolveSubIssueProcessingMode({
      issue,
      trigger: "command_refresh",
      configuredMode: "skip"
    })).toBe("relaxed");
    expect(resolveSubIssueProcessingMode({
      issue: createIssue(),
      trigger: "issue_opened",
      configuredMode: "relaxed"
    })).toBe("normal");
  });

  it("accepts a sub-issue without required sections but only inherits a detected template", () => {
    const config = createConfig();
    const detected = createRelaxedSubIssueValidation({
      title: "[bug] Child task",
      body: "<!-- issue-template: bug -->\n\nShort implementation task.",
      config: config.issues.validation
    });
    const generic = createRelaxedSubIssueValidation({
      title: "Child implementation task",
      body: "No issue form fields are present.",
      config: config.issues.validation
    });

    expect(detected.valid).toBe(true);
    expect(detected.executed).toBe(false);
    expect(detected.desiredLabels).toEqual(["BUG"]);
    expect(detected.commentBody).toBeUndefined();
    expect(generic.template).toBeUndefined();
    expect(generic.desiredLabels).toEqual([]);

    config.issues.validation.enabled = false;
    const disabled = createRelaxedSubIssueValidation({
      title: "[bug] Child task",
      body: "<!-- issue-template: bug -->",
      config: config.issues.validation
    });
    expect(disabled.template).toBeUndefined();
    expect(disabled.desiredLabels).toEqual([]);
  });

  it("identifies direct parents and children as hierarchy relations", () => {
    const child = createIssue({
      number: 2,
      parentIssueUrl: "https://api.github.com/repos/octo/repo/issues/1"
    });
    expect(isDirectIssueRelation(child, {
      number: 1,
      title: "Parent",
      body: "",
      labels: [],
      state: "open",
      htmlUrl: "https://github.com/octo/repo/issues/1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    })).toBe(true);

    const parent = createIssue({ number: 1 });
    expect(isDirectIssueRelation(parent, {
      number: 2,
      title: "Child",
      body: "",
      labels: [],
      state: "open",
      htmlUrl: "https://github.com/octo/repo/issues/2",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      parentIssueUrl: "https://api.github.com/repos/octo/repo/issues/1"
    })).toBe(true);
  });
});
