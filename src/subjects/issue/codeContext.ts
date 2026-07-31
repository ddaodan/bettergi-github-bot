import * as core from "@actions/core";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { containsSensitiveText, isSensitivePath } from "../../core/aiSafety.js";
import type {
  IssueCodeContextConfig,
  IssueContext,
  ParsedIssue,
  RepositoryAiContext,
  RepositoryCodeContext,
  RepositoryCodeContextFile,
  RepositoryCodeContextTarget
} from "../../core/types.js";
import type { GitHubGateway, RepositoryContentEntry } from "../../github/gateway.js";
import { tokenize } from "./parser.js";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".github",
  ".repo-bot",
  "node_modules",
  "dist",
  "coverage",
  "bin",
  "obj",
  ".tmp"
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".bmp",
  ".class",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".rar",
  ".so",
  ".ttf",
  ".woff",
  ".woff2",
  ".zip"
]);

const ENTRY_FILE_CANDIDATES = [
  "package.json",
  "src/index.ts",
  "src/index.tsx",
  "src/index.js",
  "src/main.ts",
  "src/main.tsx",
  "src/main.js",
  "src/app.ts",
  "src/app.tsx",
  "src/app.js",
  "Program.cs",
  "appsettings.json"
];

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "when",
  "where",
  "what",
  "which",
  "issue",
  "bug",
  "feature",
  "question",
  "summary",
  "environment",
  "expected",
  "behavior",
  "steps",
  "description",
  "version"
]);

const MAX_FILE_BYTES = 300 * 1024;
const MAX_CONTEXT_FILES = 8;
const MAX_EXCERPT_CHARS = 2000;
const MAX_KEYWORDS = 24;
const MAX_FALLBACK_ENTRY_FILES = 3;
const MAX_REMOTE_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_LISTED_ENTRIES = 400;
const MAX_REMOTE_DIRECTORY_DEPTH = 4;

type RankedFile = RepositoryCodeContextFile & {
  score: number;
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isLikelyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    const isWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isUtf8Lead = byte >= 128;
    if (!isWhitespace && !isPrintableAscii && !isUtf8Lead) {
      suspicious += 1;
    }
  }

  return suspicious / Math.max(sample.length, 1) < 0.1;
}

function truncateExcerpt(value: string): string {
  if (value.length <= MAX_EXCERPT_CHARS) {
    return value.trim();
  }

  return `${value.slice(0, MAX_EXCERPT_CHARS).trimEnd()}\n...`;
}

function createExcerpt(content: string, keywords: string[]): string {
  const lower = content.toLowerCase();
  let firstIndex = -1;

  for (const keyword of keywords) {
    const index = lower.indexOf(keyword);
    if (index >= 0 && (firstIndex === -1 || index < firstIndex)) {
      firstIndex = index;
    }
  }

  if (firstIndex === -1) {
    return truncateExcerpt(content);
  }

  const start = Math.max(0, firstIndex - 400);
  const end = Math.min(content.length, start + MAX_EXCERPT_CHARS);
  const excerpt = content.slice(start, end).trim();
  const prefix = start > 0 ? "...\n" : "";
  const suffix = end < content.length ? "\n..." : "";
  return `${prefix}${excerpt}${suffix}`.trim();
}

function buildKeywords(params: {
  issue: IssueContext;
  parsed: ParsedIssue;
  repositoryContext: RepositoryAiContext;
}): string[] {
  const raw = [
    params.issue.title,
    params.issue.body,
    ...Object.values(params.parsed.sections),
    params.repositoryContext.projectProfile.name,
    ...params.repositoryContext.projectProfile.aliases
  ].join("\n");

  return [...new Set(tokenize(raw))]
    .filter((token) => {
      if (STOPWORDS.has(token)) {
        return false;
      }

      return /[^\x00-\x7F]/.test(token) ? token.length >= 2 : token.length >= 3;
    })
    .sort((left, right) => right.length - left.length)
    .slice(0, MAX_KEYWORDS);
}

function scoreFile(params: {
  relativePath: string;
  content: string;
  keywords: string[];
}): RankedFile | undefined {
  const normalizedPath = normalizePath(params.relativePath).toLowerCase();
  const lowerContent = params.content.toLowerCase();
  const pathHits = params.keywords.filter((keyword) => normalizedPath.includes(keyword)).length;
  const contentHits = params.keywords.filter((keyword) => lowerContent.includes(keyword)).length;
  const score = pathHits * 3 + contentHits;

  if (score <= 0) {
    return undefined;
  }

  let reason = "文件内容命中了 Issue 关键词。";
  if (pathHits > 0 && contentHits > 0) {
    reason = "文件路径和内容都命中了 Issue 关键词。";
  } else if (pathHits > 0) {
    reason = "文件路径命中了 Issue 关键词。";
  }

  return {
    path: normalizePath(params.relativePath),
    reason,
    excerpt: createExcerpt(params.content, params.keywords),
    score
  };
}

async function walkFiles(root: string, currentDir = root): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...await walkFiles(root, absolutePath));
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  if (isSensitivePath(filePath)) {
    return undefined;
  }

  const extension = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) {
    return undefined;
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES) {
    return undefined;
  }

  const buffer = await readFile(filePath);
  if (!isLikelyText(buffer)) {
    return undefined;
  }

  const content = buffer.toString("utf8");
  if (containsSensitiveText(content)) {
    return undefined;
  }

  return content;
}

function createFallbackFile(pathLabel: string, reason: string, excerpt: string): RepositoryCodeContextFile | undefined {
  const trimmed = excerpt.trim();
  if (!trimmed || isSensitivePath(pathLabel) || containsSensitiveText(trimmed)) {
    return undefined;
  }

  return {
    path: normalizePath(pathLabel),
    reason,
    excerpt: truncateExcerpt(trimmed)
  };
}

async function buildFallbackContext(params: {
  workspace: string;
  repositoryContext: RepositoryAiContext;
}): Promise<RepositoryCodeContext> {
  const files: RepositoryCodeContextFile[] = [];
  const readmePath = path.join(params.workspace, "README.md");

  try {
    const readme = await readTextFile(readmePath);
    const readmeFile = createFallbackFile("README.md", "仓库 README 回退上下文。", readme ?? "");
    if (readmeFile) {
      files.push(readmeFile);
    }
  } catch {
    const readmeFile = createFallbackFile(
      "README.md",
      "仓库 README 回退上下文。",
      params.repositoryContext.readmeExcerpt
    );
    if (readmeFile) {
      files.push(readmeFile);
    }
  }

  for (const candidate of ENTRY_FILE_CANDIDATES) {
    if (files.length >= 1 + MAX_FALLBACK_ENTRY_FILES) {
      break;
    }

    const absolutePath = path.join(params.workspace, candidate);
    try {
      const content = await readTextFile(absolutePath);
      const fallbackFile = createFallbackFile(candidate, "仓库入口文件回退上下文。", content ?? "");
      if (fallbackFile) {
        files.push(fallbackFile);
      }
    } catch {
      continue;
    }
  }

  return {
    files,
    fallbackUsed: true
  };
}

async function collectWorkspaceCodeContext(params: {
  workspace: string;
  issue: IssueContext;
  parsed: ParsedIssue;
  repositoryContext: RepositoryAiContext;
}): Promise<RepositoryCodeContext> {
  const keywords = buildKeywords(params);
  if (keywords.length === 0) {
    return buildFallbackContext({
      workspace: params.workspace,
      repositoryContext: params.repositoryContext
    });
  }

  const files = await walkFiles(params.workspace);
  const ranked: RankedFile[] = [];

  for (const absolutePath of files) {
    try {
      const content = await readTextFile(absolutePath);
      if (!content) {
        continue;
      }

      const relativePath = path.relative(params.workspace, absolutePath);
      const candidate = scoreFile({
        relativePath,
        content,
        keywords
      });
      if (candidate) {
        ranked.push(candidate);
      }
    } catch {
      continue;
    }
  }

  if (ranked.length === 0) {
    return buildFallbackContext({
      workspace: params.workspace,
      repositoryContext: params.repositoryContext
    });
  }

  ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  return {
    files: ranked.slice(0, MAX_CONTEXT_FILES).map(({ path: filePath, reason, excerpt }) => ({
      path: filePath,
      reason,
      excerpt
    })),
    fallbackUsed: false
  };
}

type RemoteIndexNode = {
  name?: unknown;
  type?: unknown;
  version?: unknown;
  author?: unknown;
  authors?: unknown;
  description?: unknown;
  children?: unknown;
  [key: string]: unknown;
};

type RankedRemoteTarget = {
  target: RepositoryCodeContextTarget;
  type: "file" | "dir";
  score: number;
};

function normalizeHeadingKey(value: string): string {
  return value.toLowerCase().replace(/[*_\x60:#]/g, "").trim();
}

function getConfiguredSection(parsed: ParsedIssue, aliases: string[]): string {
  for (const alias of aliases) {
    const value = parsed.sections[normalizeHeadingKey(alias)];
    if (value?.trim()) {
      return value.trim();
    }
  }
  return "";
}

function firstMeaningfulLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^_?no response_?$/i.test(line)) ?? "";
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function splitNameAndVersion(value: string): { name: string; version: string } {
  const line = firstMeaningfulLine(value).replace(/^[\x60'"]+|[\x60'"]+$/g, "").trim();
  const match = line.match(/^(.*?)(?:\s*[:：]\s*|\s+)(v?\d[\w.-]*)$/i);
  if (!match?.[1] || !match[2]) {
    return { name: line, version: "" };
  }
  return {
    name: match[1].trim(),
    version: match[2].replace(/^v/i, "").trim()
  };
}

function normalizeRepositoryPath(value: string): string | undefined {
  let candidate = value.trim().replace(/\\/g, "/");
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return undefined;
  }
  candidate = candidate
    .replace(/[?#].*$/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

  if (!candidate || candidate.split("/").some((segment) => segment === ".." || segment === ".")) {
    return undefined;
  }
  return candidate;
}

function extractExplicitRepositoryPath(params: {
  value: string;
  repositoryContext: RepositoryAiContext;
}): string | undefined {
  const githubPattern = /https:\/\/github\.com\/([^/\s)]+)\/([^/\s)]+)\/(?:blob|tree)\/[^/\s)]+\/([^\s)]+)/i;
  const match = params.value.match(githubPattern);
  if (match?.[1] && match[2] && match[3]) {
    if (
      match[1].toLowerCase() !== params.repositoryContext.owner.toLowerCase()
      || match[2].toLowerCase() !== params.repositoryContext.repo.toLowerCase()
    ) {
      return undefined;
    }
    return normalizeRepositoryPath(match[3]);
  }

  const line = firstMeaningfulLine(params.value)
    .replace(/^\[[^\]]+\]\(([^)]+)\)$/, "$1")
    .replace(/^[\x60'"]+|[\x60'"]+$/g, "");
  return normalizeRepositoryPath(line);
}

function configuredRoots(config: IssueCodeContextConfig): string[] {
  return [...new Set(Object.values(config.categoryRoots)
    .flat()
    .map(normalizeRepositoryPath)
    .filter((value): value is string => Boolean(value)))];
}

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + "/");
}

function isAllowedRepositoryPath(candidate: string, config: IssueCodeContextConfig): boolean {
  const roots = configuredRoots(config);
  return roots.length === 0 || roots.some((root) => isWithinRoot(candidate, root));
}

function resolveCategoryRoots(params: {
  config: IssueCodeContextConfig;
  parsed: ParsedIssue;
}): string[] {
  const selected = normalizeComparable(firstMeaningfulLine(getConfiguredSection(
    params.parsed,
    params.config.categorySectionAliases
  )));
  if (!selected) {
    return configuredRoots(params.config);
  }

  for (const [category, roots] of Object.entries(params.config.categoryRoots)) {
    if (normalizeComparable(category) === selected) {
      return roots
        .map(normalizeRepositoryPath)
        .filter((value): value is string => Boolean(value));
    }
  }

  return configuredRoots(params.config);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function indexDisplayName(node: RemoteIndexNode): string {
  return stringValue(node.description).split("~|~")[0]?.trim() ?? "";
}

function collectIndexTargets(params: {
  value: unknown;
  parentPath: string;
  results: RankedRemoteTarget[];
}): void {
  if (Array.isArray(params.value)) {
    for (const child of params.value) {
      collectIndexTargets({
        value: child,
        parentPath: params.parentPath,
        results: params.results
      });
    }
    return;
  }

  if (!params.value || typeof params.value !== "object") {
    return;
  }

  const node = params.value as RemoteIndexNode;
  const name = stringValue(node.name);
  const nodePath = name
    ? normalizeRepositoryPath(params.parentPath ? params.parentPath + "/" + name : name)
    : params.parentPath;

  if (name && nodePath) {
    const rawType = stringValue(node.type).toLowerCase();
    params.results.push({
      target: {
        path: nodePath,
        name,
        version: stringValue(node.version) || undefined,
        author: stringValue(node.author) || stringValue(node.authors) || undefined,
        description: indexDisplayName(node) || undefined
      },
      type: rawType === "file" ? "file" : "dir",
      score: 0
    });
  }

  if (Array.isArray(node.children)) {
    collectIndexTargets({
      value: node.children,
      parentPath: nodePath ?? params.parentPath,
      results: params.results
    });
  }
}

function parseIndexTargets(raw: string, config: IssueCodeContextConfig): RankedRemoteTarget[] {
  const parsed = JSON.parse(raw) as unknown;
  let roots: unknown = parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    roots = Array.isArray(record.indexes) ? record.indexes : parsed;
  }

  const results: RankedRemoteTarget[] = [];
  collectIndexTargets({
    value: roots,
    parentPath: normalizeRepositoryPath(config.indexRoot) ?? "",
    results
  });
  return results;
}

function scoreRemoteTarget(params: {
  candidate: RankedRemoteTarget;
  queryName: string;
  queryVersion: string;
  categoryRoots: string[];
}): number {
  if (
    params.categoryRoots.length > 0
    && !params.categoryRoots.some((root) => isWithinRoot(params.candidate.target.path, root))
  ) {
    return 0;
  }

  const query = normalizeComparable(params.queryName);
  if (!query) {
    return 0;
  }
  const names = [
    params.candidate.target.name,
    params.candidate.target.description ?? ""
  ].map(normalizeComparable).filter(Boolean);

  let score = 0;
  if (names.some((name) => name === query)) {
    score = 100;
  } else if (names.some((name) => name.includes(query) || query.includes(name))) {
    score = 80;
  } else {
    const queryTokens = tokenize(params.queryName);
    const candidateTokens = tokenize(names.join(" "));
    const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
    if (overlap > 0) {
      score = 50 + Math.min(20, overlap * 5);
    }
  }

  if (
    score > 0
    && params.queryVersion
    && params.candidate.target.version
    && normalizeComparable(params.queryVersion) === normalizeComparable(params.candidate.target.version)
  ) {
    score += 5;
  }
  return score;
}

function remoteEntryPriority(entry: RepositoryContentEntry, keywords: string[]): number {
  const lowerPath = normalizePath(entry.path).toLowerCase();
  const lowerName = entry.name.toLowerCase();
  const preferredNames = new Map<string, number>([
    ["readme.md", 60],
    ["manifest.json", 58],
    ["main.js", 56],
    ["main.ts", 56],
    ["settings.json", 52],
    ["package.json", 48],
    ["index.js", 44],
    ["index.ts", 44]
  ]);
  const preferred = preferredNames.get(lowerName) ?? 0;
  const keywordHits = keywords.filter((keyword) => lowerPath.includes(keyword)).length;
  return preferred + keywordHits * 10;
}

function isRemoteTextCandidate(entry: RepositoryContentEntry): boolean {
  if (entry.type !== "file" || entry.size > MAX_FILE_BYTES || isSensitivePath(entry.path)) {
    return false;
  }
  return !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
}

async function listRemoteTargetFiles(params: {
  gateway: GitHubGateway;
  target: RankedRemoteTarget;
}): Promise<RepositoryContentEntry[]> {
  if (params.target.type === "file") {
    return [{
      path: params.target.target.path,
      name: path.posix.basename(params.target.target.path),
      type: "file",
      size: 0,
      sha: ""
    }];
  }

  const queue: Array<{ path: string; depth: number }> = [{
    path: params.target.target.path,
    depth: 0
  }];
  const files: RepositoryContentEntry[] = [];
  let listed = 0;

  while (queue.length > 0 && listed < MAX_REMOTE_LISTED_ENTRIES) {
    const current = queue.shift()!;
    const entries = await params.gateway.getRepositoryDirectory(current.path);
    listed += entries.length;

    for (const entry of entries) {
      if (entry.type === "file") {
        files.push(entry);
        continue;
      }
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      if (current.depth < MAX_REMOTE_DIRECTORY_DEPTH) {
        queue.push({
          path: entry.path,
          depth: current.depth + 1
        });
      }
    }
  }

  return files;
}

async function readRemoteContextFiles(params: {
  gateway: GitHubGateway;
  target: RankedRemoteTarget;
  keywords: string[];
}): Promise<RepositoryCodeContextFile[]> {
  const entries = await listRemoteTargetFiles({
    gateway: params.gateway,
    target: params.target
  });
  const ranked = entries
    .filter(isRemoteTextCandidate)
    .map((entry) => ({
      entry,
      score: remoteEntryPriority(entry, params.keywords)
    }))
    .sort((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path));

  const files: RepositoryCodeContextFile[] = [];
  for (const { entry, score } of ranked) {
    if (files.length >= MAX_CONTEXT_FILES) {
      break;
    }
    try {
      const content = await params.gateway.getRepositoryTextFile(entry.path, MAX_FILE_BYTES);
      if (!content) {
        continue;
      }
      const buffer = Buffer.from(content, "utf8");
      if (!isLikelyText(buffer) || containsSensitiveText(content)) {
        continue;
      }

      files.push({
        path: normalizePath(entry.path),
        reason: score > 0
          ? "目标脚本中的入口、说明或 Issue 关键词相关文件。"
          : "目标脚本中的文本文件。",
        excerpt: createExcerpt(content, params.keywords)
      });
    } catch (error) {
      core.info('Skip repository code file "' + entry.path + '": ' + String(error));
    }
  }
  return files;
}

async function resolveRemoteTarget(params: {
  issue: IssueContext;
  parsed: ParsedIssue;
  repositoryContext: RepositoryAiContext;
  config: IssueCodeContextConfig;
  gateway: GitHubGateway;
}): Promise<{
  target?: RankedRemoteTarget;
  status: "resolved" | "ambiguous" | "not_found";
  query: string;
  candidatePaths: string[];
}> {
  const explicitValue = getConfiguredSection(params.parsed, params.config.pathSectionAliases);
  const explicitPath = extractExplicitRepositoryPath({
    value: explicitValue,
    repositoryContext: params.repositoryContext
  });
  if (explicitPath) {
    if (!isAllowedRepositoryPath(explicitPath, params.config) || isSensitivePath(explicitPath)) {
      return {
        status: "not_found",
        query: explicitPath,
        candidatePaths: []
      };
    }

    const directoryEntries = await params.gateway.getRepositoryDirectory(explicitPath);
    const type: "file" | "dir" = directoryEntries.length > 0 ? "dir" : "file";
    if (type === "file") {
      const content = await params.gateway.getRepositoryTextFile(explicitPath, MAX_FILE_BYTES);
      if (content === undefined) {
        return {
          status: "not_found",
          query: explicitPath,
          candidatePaths: []
        };
      }
    }

    return {
      status: "resolved",
      query: explicitPath,
      candidatePaths: [explicitPath],
      target: {
        target: {
          path: explicitPath,
          name: path.posix.basename(explicitPath)
        },
        type,
        score: 200
      }
    };
  }

  const rawName = getConfiguredSection(params.parsed, params.config.nameSectionAliases);
  const query = splitNameAndVersion(rawName);
  if (!query.name || !params.config.indexPath) {
    return {
      status: "not_found",
      query: query.name,
      candidatePaths: []
    };
  }

  const rawIndex = await params.gateway.getRepositoryTextFile(
    params.config.indexPath,
    MAX_REMOTE_INDEX_BYTES
  );
  if (!rawIndex) {
    return {
      status: "not_found",
      query: query.name,
      candidatePaths: []
    };
  }

  const categoryRoots = resolveCategoryRoots({
    config: params.config,
    parsed: params.parsed
  });
  const ranked = parseIndexTargets(rawIndex, params.config)
    .map((candidate) => ({
      ...candidate,
      score: scoreRemoteTarget({
        candidate,
        queryName: query.name,
        queryVersion: query.version,
        categoryRoots
      })
    }))
    .filter((candidate) => candidate.score >= 80)
    .sort((left, right) => right.score - left.score || left.target.path.localeCompare(right.target.path));

  const top = ranked[0];
  if (!top) {
    return {
      status: "not_found",
      query: query.name,
      candidatePaths: []
    };
  }
  const tied = ranked.filter((candidate) => candidate.score === top.score);
  if (tied.length > 1) {
    return {
      status: "ambiguous",
      query: query.name,
      candidatePaths: tied.slice(0, 3).map((candidate) => candidate.target.path)
    };
  }

  return {
    status: "resolved",
    query: query.name,
    candidatePaths: [top.target.path],
    target: top
  };
}

async function collectGitHubCodeContext(params: {
  issue: IssueContext;
  parsed: ParsedIssue;
  repositoryContext: RepositoryAiContext;
  config: IssueCodeContextConfig;
  gateway: GitHubGateway;
}): Promise<RepositoryCodeContext> {
  try {
    const resolved = await resolveRemoteTarget(params);
    if (!resolved.target) {
      return {
        files: [],
        fallbackUsed: true,
        resolution: {
          status: resolved.status,
          query: resolved.query,
          candidatePaths: resolved.candidatePaths
        }
      };
    }

    const keywords = buildKeywords(params);
    const files = await readRemoteContextFiles({
      gateway: params.gateway,
      target: resolved.target,
      keywords
    });
    return {
      files,
      fallbackUsed: files.length === 0,
      targets: [resolved.target.target],
      resolution: {
        status: "resolved",
        query: resolved.query,
        candidatePaths: resolved.candidatePaths
      }
    };
  } catch (error) {
    core.warning("Unable to resolve repository code context through GitHub: " + String(error));
    return {
      files: [],
      fallbackUsed: true,
      resolution: {
        status: "unavailable",
        query: firstMeaningfulLine(getConfiguredSection(
          params.parsed,
          params.config.nameSectionAliases
        )),
        candidatePaths: []
      }
    };
  }
}

const DEFAULT_CODE_CONTEXT_CONFIG: IssueCodeContextConfig = {
  source: "workspace",
  includeInAiHelp: false,
  includeInFix: true,
  indexPath: "",
  indexRoot: "",
  categorySectionAliases: [],
  nameSectionAliases: [],
  pathSectionAliases: [],
  categoryRoots: {}
};

export async function collectRepositoryCodeContext(params: {
  workspace: string;
  issue: IssueContext;
  parsed: ParsedIssue;
  repositoryContext: RepositoryAiContext;
  config?: IssueCodeContextConfig;
  gateway?: GitHubGateway;
}): Promise<RepositoryCodeContext> {
  const config = params.config ?? DEFAULT_CODE_CONTEXT_CONFIG;
  if (config.source === "github") {
    if (!params.gateway) {
      return {
        files: [],
        fallbackUsed: true,
        resolution: {
          status: "unavailable",
          query: "",
          candidatePaths: []
        }
      };
    }
    return collectGitHubCodeContext({
      issue: params.issue,
      parsed: params.parsed,
      repositoryContext: params.repositoryContext,
      config,
      gateway: params.gateway
    });
  }

  return collectWorkspaceCodeContext(params);
}
