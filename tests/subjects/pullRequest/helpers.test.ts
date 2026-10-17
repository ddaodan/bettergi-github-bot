import { describe, expect, it } from "vitest";

import {
  appendCloseKeywords,
  collectPullRequestIssueReferences,
  extractIssueReferences,
  findUnclosedIssueReferences
} from "../../../src/subjects/pullRequest/issueLink.js";
import {
  checkPullRequestFileLocations
} from "../../../src/subjects/pullRequest/locationCheck.js";
import {
  classifyPullRequestFiles,
  isInsideScriptDirectory
} from "../../../src/subjects/pullRequest/pathClassification.js";
import type { PullRequestLocationCheckConfig } from "../../../src/core/types.js";

const locationConfig: PullRequestLocationCheckConfig = {
  enabled: true,
  commentAnchor: "pull-bot:location",
  allowedPaths: ["build", ".github"],
  scriptRoots: ["repo/js"],
  fileKindRules: [
    { category: "战斗策略", expectedLocation: "repo/combat", extensions: [".txt"] }
  ],
  rules: {
    pathingFileNamePattern: "^\\d{2,3}-",
    pathingRequireReadme: false,
    jsFolderNameNoSpace: false,
    jsFolderNamePattern: ""
  }
};

const rules = [
  { label: "JS 脚本", pathPrefixes: ["repo/js"] },
  { label: "地图追踪", pathPrefixes: ["repo/pathing"] },
  { label: "战斗策略", pathPrefixes: ["repo/combat"] },
  { label: "七圣召唤", pathPrefixes: ["repo/tcg"] }
];

describe("classifyPullRequestFiles", () => {
  it("maps each category directory to its label", () => {
    const result = classifyPullRequestFiles({
      files: ["repo/tcg/deck.txt", "repo/combat/team.txt", "repo/pathing/矿物/01-水晶块.json"],
      rules
    });

    expect(result.matchedLabels.sort()).toEqual(["七圣召唤", "地图追踪", "战斗策略"].sort());
    expect(result.unmatchedFiles).toEqual([]);
  });

  it("treats pathing assets inside a script folder as JS script content only", () => {
    const result = classifyPullRequestFiles({
      files: ["repo/js/MyScript/Assets/Pathing/route.json"],
      rules
    });

    expect(result.matchedLabels).toEqual(["JS 脚本"]);
  });

  it("supports multiple labels for a mixed pull request", () => {
    const result = classifyPullRequestFiles({
      files: ["repo/js/A/main.js", "repo/pathing/矿物/x.json"],
      rules
    });

    expect(result.matchedLabels.sort()).toEqual(["JS 脚本", "地图追踪"].sort());
  });

  it("reports documentation-only changes and unmatched files", () => {
    expect(classifyPullRequestFiles({ files: ["README.md", "docs/a.md"], rules }).documentationOnly).toBe(true);
    expect(classifyPullRequestFiles({ files: ["README.md", "repo/js/A/main.js"], rules }).documentationOnly).toBe(false);

    const unmatched = classifyPullRequestFiles({ files: ["LICENSE"], rules });
    expect(unmatched.matchedAnyRule).toBe(false);
    expect(unmatched.unmatchedFiles).toEqual(["LICENSE"]);
  });
});

describe("isInsideScriptDirectory", () => {
  it("accepts any depth and casing inside a script folder", () => {
    expect(isInsideScriptDirectory("repo/js/Demo/main.js", ["repo/js"])).toBe(true);
    expect(isInsideScriptDirectory("repo/js/Demo/Assets/Pathing/a.json", ["repo/js"])).toBe(true);
    expect(isInsideScriptDirectory("repo/js/Demo/assets/pathing/a.json", ["repo/js"])).toBe(true);
  });

  it("rejects files sitting directly in the scripts root", () => {
    expect(isInsideScriptDirectory("repo/js/manifest.json", ["repo/js"])).toBe(false);
  });
});

describe("checkPullRequestFileLocations", () => {
  it("accepts well placed files", () => {
    const issues = checkPullRequestFileLocations({
      files: ["repo/js/Demo/main.js", "repo/pathing/矿物/01-水晶块.json", "repo/combat/team.txt"],
      config: locationConfig
    });

    expect(issues).toEqual([]);
  });

  it("accepts pathing assets inside script directories even outside repo/pathing", () => {
    const issues = checkPullRequestFileLocations({
      files: ["repo/js/Demo/Assets/Pathing/route.json"],
      config: locationConfig
    });

    expect(issues).toEqual([]);
  });

  it("flags JS files outside repo/js", () => {
    const issues = checkPullRequestFileLocations({
      files: ["scripts/main.js"],
      config: locationConfig
    });

    expect(issues.map((issue) => issue.expectedLocation)).toEqual(["repo/js"]);
  });

  it("flags combat tactics outside repo/combat", () => {
    const issues = checkPullRequestFileLocations({
      files: ["repo/tcg/队伍.txt"],
      config: locationConfig
    });

    expect(issues.map((issue) => issue.expectedLocation)).toContain("repo/combat");
  });

  it("flags pathing files whose name does not follow the numbering rule", () => {
    const issues = checkPullRequestFileLocations({
      files: ["repo/pathing/矿物/水晶块-快速路线.json"],
      config: locationConfig
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toContain("编号");
  });

  it("ignores maintainer files and configured allowed paths", () => {
    const issues = checkPullRequestFileLocations({
      files: ["README.md", ".github/workflows/x.yml", "build/index.html", "LICENSE"],
      config: locationConfig
    });

    expect(issues).toEqual([]);
  });
});

describe("issue references", () => {
  it("detects close keywords in English and Chinese", () => {
    const refs = extractIssueReferences("Fixes #12 and 修复 #34 but see #56", "body");
    const byNumber = new Map(refs.map((ref) => [ref.number, ref.hasCloseKeyword]));

    expect(byNumber.get(12)).toBe(true);
    expect(byNumber.get(34)).toBe(true);
    expect(byNumber.get(56)).toBe(false);
  });

  it("merges duplicates across title, body and commits", () => {
    const refs = collectPullRequestIssueReferences({
      title: "Fix crash #7",
      body: "see #7 again",
      commitMessages: ["resolves #7"]
    });

    expect(refs).toHaveLength(1);
    expect(refs[0]?.hasCloseKeyword).toBe(true);
  });

  it("returns references without close keywords", () => {
    const refs = collectPullRequestIssueReferences({
      title: "Improve UI #9",
      body: "should fix the crash reported in #9",
      commitMessages: []
    });

    expect(findUnclosedIssueReferences(refs).map((ref) => ref.number)).toEqual([9]);
  });

  it("appends close keywords idempotently", () => {
    const once = appendCloseKeywords({ body: "描述", numbers: [5], template: "close #{number}" });
    expect(once).toBe("描述\n\nclose #5");

    const twice = appendCloseKeywords({ body: once, numbers: [5], template: "close #{number}" });
    expect(twice).toBe(once);
  });

  it("does not duplicate keywords for issues already closed by the description", () => {
    const body = "close #5";
    expect(appendCloseKeywords({ body, numbers: [5, 6], template: "close #{number}" })).toBe("close #5\n\nclose #6");
  });
});
