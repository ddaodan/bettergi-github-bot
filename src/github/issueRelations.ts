export interface GitHubIssueCoordinates {
  owner: string;
  repo: string;
  number: number;
  apiUrl: string;
  htmlUrl: string;
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

  const owner = decodeURIComponent(match[1]);
  const repo = decodeURIComponent(match[2]);
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number <= 0) {
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
