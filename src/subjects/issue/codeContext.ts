import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { containsSensitiveText, isSensitivePath } from "../../core/aiSafety.js";
import type {
  IssueContext,
  ParsedIssue,
  RepositoryAiContext,
  RepositoryCodeContext,
  RepositoryCodeContextFile
} from "../../core/types.js";
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

export async function collectRepositoryCodeContext(params: {
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
