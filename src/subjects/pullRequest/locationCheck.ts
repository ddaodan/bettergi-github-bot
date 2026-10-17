import type { PullRequestLocationCheckConfig } from "../../core/types.js";
import { isInsideScriptDirectory, pathMatchesPrefixes } from "./pathClassification.js";

export interface PullRequestLocationIssue {
  file: string;
  /** Category the file appears to belong to, if it could be inferred. */
  detectedCategory?: string;
  /** Expected location hint shown to the contributor. */
  expectedLocation: string;
  /** Short reason why this file looks misplaced. */
  reason: string;
}

const MAINTAINER_FILE_PATTERNS = [
  /^\.github\//i,
  /^build\//i,
  /^bettergi\.d\.ts$/i,
  /^readme([.-][a-z]+)?\.md$/i,
  /^license([.-][a-z]+)?$/i,
  /^\.gitignore$/i,
  /^\.gitattributes$/i,
  /^\.editorconfig$/i,
  /^repo\.json$/i
];

function isMaintainerFile(path: string): boolean {
  return MAINTAINER_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function fileNameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Checks where a changed file should live according to the repository layout.
 *
 * Only directory-level placement is enforced (plus the optional pathing file-name rule).
 * README sub-rules such as mandatory README.md files are intentionally not enforced.
 */
export function checkPullRequestFileLocations(params: {
  files: string[];
  config: PullRequestLocationCheckConfig;
}): PullRequestLocationIssue[] {
  const issues: PullRequestLocationIssue[] = [];
  const { config } = params;

  for (const file of params.files) {
    if (!file || isMaintainerFile(file)) {
      continue;
    }

    if (config.allowedPaths.some((allowed) => pathMatchesPrefixes(file, [allowed]))) {
      continue;
    }

    // Anything inside a script directory is acceptable, including pathing assets
    // stored anywhere under repo/js/<script>/ (e.g. Assets/Pathing, assets/pathing, lowercase).
    if (isInsideScriptDirectory(file, config.scriptRoots)) {
      continue;
    }

    const extension = extensionOf(file);
    const name = fileNameOf(file);

    if (pathMatchesPrefixes(file, ["repo/pathing"])) {
      const pattern = config.rules.pathingFileNamePattern;
      if (pattern && extension === ".json") {
        const baseName = name.replace(/\.json$/i, "");
        if (!new RegExp(pattern, "i").test(baseName)) {
          issues.push({
            file,
            detectedCategory: "地图追踪",
            expectedLocation: "repo/pathing",
            reason: "路线文件名不符合「编号-材料名称-[区域]-[二级区域]-二级子区域-数量」格式"
          });
        }
      }
      continue;
    }

    if (pathMatchesPrefixes(file, ["repo/js"])) {
      continue;
    }

    // JS entry files and manifests belong to a script directory.
    if (extension === ".js" || name.toLowerCase() === "manifest.json") {
      issues.push({
        file,
        detectedCategory: "JS 脚本",
        expectedLocation: "repo/js",
        reason: "JS 脚本文件应放在 repo/js 目录下"
      });
      continue;
    }

    const inferredRule = config.fileKindRules.find((rule) => rule.extensions
      .map((item) => item.toLowerCase())
      .includes(extension));
    if (inferredRule && !pathMatchesPrefixes(file, [inferredRule.expectedLocation])) {
      issues.push({
        file,
        detectedCategory: inferredRule.category,
        expectedLocation: inferredRule.expectedLocation,
        reason: `${inferredRule.category}相关文件应放在 ${inferredRule.expectedLocation} 目录下`
      });
    }
  }

  return issues;
}

export function isValidPathingFileName(name: string, pattern: string): boolean {
  if (!pattern) {
    return true;
  }
  const baseName = name.replace(/\.json$/i, "");
  return new RegExp(pattern, "i").test(baseName);
}
