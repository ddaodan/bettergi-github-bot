import type { PullRequestPathLabelRule } from "../../core/types.js";

export interface PullRequestFileClassification {
  /** Labels derived from the configured rules. */
  matchedLabels: string[];
  /** True when at least one changed file matched a rule. */
  matchedAnyRule: boolean;
  /** Files that did not match any rule (excluding documentation-only cases). */
  unmatchedFiles: string[];
  /** True when every changed file looks like documentation. */
  documentationOnly: boolean;
  /** True when paths under a script root were detected (used by the location check). */
  filesUnderScriptRoots: string[];
}

const DOCUMENTATION_EXTENSIONS = [".md", ".mdx", ".txt.md"];

export function isDocumentationPath(path: string): boolean {
  const lower = path.toLowerCase();
  return DOCUMENTATION_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
}

export function pathMatchesPrefixes(path: string, prefixes: string[]): boolean {
  const lower = path.toLowerCase();
  return prefixes.some((prefix) => {
    const normalized = normalizePrefix(prefix);
    if (!normalized) {
      return false;
    }
    return lower === normalized || lower.startsWith(`${normalized}/`);
  });
}

export function classifyPullRequestFiles(params: {
  files: string[];
  rules: PullRequestPathLabelRule[];
  scriptRoots?: string[];
  documentationLabel?: string;
}): PullRequestFileClassification {
  const labels = new Set<string>();
  const unmatchedFiles: string[] = [];
  let matchedAnyRule = false;

  for (const file of params.files) {
    const rule = params.rules.find((candidate) => pathMatchesPrefixes(file, candidate.pathPrefixes));
    if (rule) {
      labels.add(rule.label);
      matchedAnyRule = true;
      continue;
    }
    unmatchedFiles.push(file);
  }

  const documentationOnly = params.files.length > 0
    && params.files.every((file) => isDocumentationPath(file));

  const filesUnderScriptRoots = (params.scriptRoots ?? []).length > 0
    ? params.files.filter((file) => pathMatchesPrefixes(file, params.scriptRoots ?? []))
    : [];

  return {
    matchedLabels: [...labels],
    matchedAnyRule,
    unmatchedFiles,
    documentationOnly,
    filesUnderScriptRoots
  };
}

/**
 * Whether a path lives inside a script directory tree (repo/js/<script>/...).
 * Rule: any path whose first matching script root is followed by at least two segments
 * (script folder + file/dir) counts as script content, regardless of nesting depth or case.
 */
export function isInsideScriptDirectory(path: string, scriptRoots: string[]): boolean {
  const lower = path.toLowerCase();
  for (const root of scriptRoots) {
    const normalized = normalizePrefix(root);
    if (!normalized) {
      continue;
    }
    if (lower === normalized) {
      continue;
    }
    if (!lower.startsWith(`${normalized}/`)) {
      continue;
    }
    const rest = lower.slice(normalized.length + 1);
    const segments = rest.split("/").filter(Boolean);
    // script folder + something inside it
    if (segments.length >= 2) {
      return true;
    }
  }
  return false;
}
