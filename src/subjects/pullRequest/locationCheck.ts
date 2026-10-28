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
 * True when the path is a file sitting directly under `root` with no sub-directory
 * in between (e.g. `repo/js/起风了.json` for root `repo/js`).
 */
function isDirectlyInRoot(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
  if (!normalizedRoot) {
    return false;
  }
  const lower = path.toLowerCase();
  if (!lower.startsWith(`${normalizedRoot}/`)) {
    return false;
  }
  const rest = lower.slice(normalizedRoot.length + 1);
  return rest.length > 0 && !rest.includes("/");
}

/**
 * Checks where a changed file should live according to the repository layout.
 *
 * Only directory-level placement is enforced (plus the optional pathing file-name rule).
 * README sub-rules such as mandatory README.md files are intentionally not enforced.
 *
 * The check deliberately avoids guessing what a file *is* from its extension alone:
 * a loose `repo/js/*.json` could be a script config, a score file or a pathing route,
 * so it is reported as "must live inside a script folder" rather than being classified.
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

    // A file sitting directly in a script root (repo/js/xxx) is a layout violation:
    // scripts must be folders, and stray files there are usually misplaced resources.
    const strayScriptRoot = config.scriptRoots.find((root) => isDirectlyInRoot(file, root));
    if (strayScriptRoot) {
      issues.push({
        file,
        expectedLocation: `${strayScriptRoot}/<脚本名>/`,
        reason: `文件直接放在 ${strayScriptRoot} 根目录下，应放入具体的脚本目录（${strayScriptRoot}/<脚本名>/）`,
      });
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

    // JS entry files and manifests must live inside a script folder.
    if (extension === ".js" || name.toLowerCase() === "manifest.json") {
      issues.push({
        file,
        detectedCategory: "JS 脚本",
        expectedLocation: "repo/js/<脚本名>/",
        reason: "JS 脚本文件应放在 repo/js/<脚本名>/ 目录下"
      });
      continue;
    }

    const inferredRule = config.fileKindRules.find((rule) => rule.extensions
      .map((item) => item.toLowerCase())
      .includes(extension));
    if (inferredRule) {
      const accepted = inferredRule.expectedLocations.some((location) => pathMatchesPrefixes(file, [location]));
      if (!accepted) {
        const expected = inferredRule.expectedLocations.join(" 或 ");
        issues.push({
          file,
          detectedCategory: inferredRule.category,
          expectedLocation: expected,
          reason: `${inferredRule.category}相关文件应放在 ${expected} 目录下`
        });
      }
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
