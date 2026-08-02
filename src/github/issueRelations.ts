export interface GitHubIssueCoordinates {
  owner: string;
  repo: string;
  number: number;
  apiUrl: string;
  htmlUrl: string;
}

export interface GitHubCommentDerivedIssueReference extends GitHubIssueCoordinates {
  commentId: number;
  commentUrl: string;
  authorLogin: string;
  quotedBody: string;
}

function decodePathSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function parseGitHubIssueUrl(value: string | null | undefined): GitHubIssueCoordinates | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }

  let match: RegExpMatchArray | null = null;
  if (url.hostname.toLowerCase() === "api.github.com") {
    match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/i);
  } else if (url.hostname.toLowerCase() === "github.com") {
    match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/i);
  }

  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }

  const owner = decodePathSegment(match[1]);
  const repo = decodePathSegment(match[2]);
  const number = Number(match[3]);
  if (!owner || !repo || !Number.isSafeInteger(number) || number <= 0) {
    return undefined;
  }

  return {
    owner,
    repo,
    number,
    apiUrl: `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
    htmlUrl: `https://github.com/${owner}/${repo}/issues/${number}`
  };
}

function normalizeRelationText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function parseCommentDerivedIssueBody(
  body: string
): GitHubCommentDerivedIssueReference | undefined {
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  const footer = /(?:^|\n)[ \t]*_Originally posted by @([A-Za-z0-9-]+(?:\[bot\])?) in \[#(\d+)\]\((https:\/\/github\.com\/[^)\s]+)\)_[ \t]*$/i.exec(normalized);
  if (!footer?.[1] || !footer[2] || !footer[3]) {
    return undefined;
  }

  const coordinates = parseGitHubIssueUrl(footer[3]);
  let commentUrl: URL;
  try {
    commentUrl = new URL(footer[3]);
  } catch {
    return undefined;
  }

  const commentMatch = commentUrl.hash.match(/^#issuecomment-(\d+)$/i);
  const displayedIssueNumber = Number(footer[2]);
  const commentId = Number(commentMatch?.[1]);
  if (
    !coordinates
    || coordinates.number !== displayedIssueNumber
    || !Number.isSafeInteger(commentId)
    || commentId <= 0
  ) {
    return undefined;
  }

  const quoteBlock = normalized.slice(0, footer.index).trimEnd();
  const quotedLines: string[] = [];
  let hasQuotedContent = false;
  for (const line of quoteBlock.split("\n")) {
    if (!line.trim()) {
      quotedLines.push("");
      continue;
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (!quote) {
      return undefined;
    }
    quotedLines.push(quote[1] ?? "");
    hasQuotedContent = true;
  }

  const quotedBody = normalizeRelationText(quotedLines.join("\n"));
  if (!hasQuotedContent || !quotedBody) {
    return undefined;
  }

  return {
    ...coordinates,
    commentId,
    commentUrl: footer[3],
    authorLogin: footer[1],
    quotedBody
  };
}

export function matchesCommentDerivedIssueBody(
  reference: GitHubCommentDerivedIssueReference,
  commentBody: string
): boolean {
  return normalizeRelationText(reference.quotedBody) === normalizeRelationText(commentBody);
}

export function isSameRepository(
  coordinates: GitHubIssueCoordinates,
  owner: string,
  repo: string
): boolean {
  return coordinates.owner.toLowerCase() === owner.toLowerCase()
    && coordinates.repo.toLowerCase() === repo.toLowerCase();
}

export function createIssueBodyExcerpt(markdown: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }

  const normalized = markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```(?:[^\r\n]*)?[\r\n]?/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*|~~/g, "")
    .replace(/\|/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}
