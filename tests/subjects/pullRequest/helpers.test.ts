import { describe, expect, it } from "vitest";

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
    { category: "策略文件", expectedLocations: ["repo/combat", "repo/tcg"], extensions: [".txt"] }
  ],
  rules: {
    pathingFileNamePattern: "^\\d{2,3}-",
    pathingRequireReadme: false,
    jsFolderNameNoSpace: false,
    jsFolderNamePattern: ""
  }
};

const rules = [
  { label: "JS 脚本", pathPrefixes: ["repo/js"], requireSubdirectory: true },
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

  it("does not label a stray file dropped directly into the script root (#3774)", () => {
    const result = classifyPullRequestFiles({
      files: ["repo/js/起风了.json"],
      rules
    });

    expect(result.matchedLabels).toEqual([]);
    expect(result.unmatchedFiles).toEqual(["repo/js/起风了.json"]);
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

    expect(issues.map((issue) => issue.expectedLocation)).toEqual(["repo/js/<脚本名>/"]);
  });

  it("flags a file dropped directly into the script root (#3774)", () => {
    const issues = checkPullRequestFileLocations({
      files: ["repo/js/起风了.json"],
      config: locationConfig
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.expectedLocation).toBe("repo/js/<脚本名>/");
  });

  it("still accepts a loose asset inside a real script folder", () => {
    const issues = checkPullRequestFileLocations({
      files: ["repo/js/某脚本/起风了.json", "repo/js/某脚本/main.js"],
      config: locationConfig
    });

    expect(issues).toEqual([]);
  });

  it("accepts strategy files in either repo/combat or repo/tcg", () => {
    const issues = checkPullRequestFileLocations({
      files: ["repo/combat/队伍.txt", "repo/tcg/牌组.txt"],
      config: locationConfig
    });

    expect(issues).toEqual([]);
  });

  it("flags strategy files outside both strategy directories", () => {
    const issues = checkPullRequestFileLocations({
      files: ["docs/队伍.txt"],
      config: locationConfig
    });

    expect(issues.map((issue) => issue.expectedLocation)).toContain("repo/combat 或 repo/tcg");
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
