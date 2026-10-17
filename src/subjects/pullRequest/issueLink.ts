export interface PullRequestIssueReference {
  number: number;
  /** How the reference was found in the pull request text. */
  source: "title" | "body" | "commit";
  /** True when the surrounding text already contains a closing keyword. */
  hasCloseKeyword: boolean;
}

const CLOSE_KEYWORD_PATTERN = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|修复|解决|处理|关闭)/gi;

/** Words that may appear between a closing keyword and the issue reference. */
const CONNECTOR_PATTERN = /^[\s:：,，、]+$/;

function stripMarkdownLinks(value: string): string {
  return value.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/**
 * Determines whether the text immediately preceding an issue reference contains a
 * closing keyword. Only the closest keyword counts, and only if everything between
 * that keyword and the reference is whitespace or punctuation (optionally with a
 * short connector such as "the crash in"). This keeps `Fixes #12 and see #56` from
 * marking #56 as closable.
 */
function hasCloseKeywordBefore(prefix: string): boolean {
  const normalized = stripMarkdownLinks(prefix);
  CLOSE_KEYWORD_PATTERN.lastIndex = 0;

  let closestEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = CLOSE_KEYWORD_PATTERN.exec(normalized)) !== null) {
    closestEnd = match.index + match[0].length;
  }

  if (closestEnd < 0) {
    return false;
  }

  const between = normalized.slice(closestEnd);
  if (between.trim().length === 0) {
    return true;
  }

  // Allow short connectors like " #", " the crash in ", but not another issue reference.
  if (CONNECTOR_PATTERN.test(between)) {
    return true;
  }
  if (between.includes("#")) {
    return false;
  }
  return between.trim().length <= 20;
}

/**
 * Finds `#123` references in a piece of text and reports whether each reference
 * is preceded by a closing keyword such as "close", "fixes", "修复" or "解决".
 */
export function extractIssueReferences(
  text: string,
  source: PullRequestIssueReference["source"]
): PullRequestIssueReference[] {
  const references: PullRequestIssueReference[] = [];
  const pattern = /#(\d{1,7})\b/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number <= 0) {
      continue;
    }

    // Inspect the same line before the reference, bounded to a reasonable window.
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const prefix = text.slice(Math.max(lineStart, match.index - 120), match.index);

    references.push({
      number,
      source,
      hasCloseKeyword: hasCloseKeywordBefore(prefix)
    });
  }

  return references;
}

export function collectPullRequestIssueReferences(params: {
  title: string;
  body: string;
  commitMessages: string[];
}): PullRequestIssueReference[] {
  const collected = new Map<number, PullRequestIssueReference>();

  const addAll = (references: PullRequestIssueReference[]): void => {
    for (const reference of references) {
      const existing = collected.get(reference.number);
      if (!existing) {
        collected.set(reference.number, reference);
        continue;
      }
      if (reference.hasCloseKeyword) {
        existing.hasCloseKeyword = true;
      }
    }
  };

  addAll(extractIssueReferences(params.title, "title"));
  addAll(extractIssueReferences(params.body, "body"));
  for (const message of params.commitMessages) {
    addAll(extractIssueReferences(message, "commit"));
  }

  return [...collected.values()];
}

/** References that clearly resolve an issue but lack the closing keyword. */
export function findUnclosedIssueReferences(
  references: PullRequestIssueReference[]
): PullRequestIssueReference[] {
  return references.filter((reference) => !reference.hasCloseKeyword);
}

export function renderCloseKeyword(template: string, number: number): string {
  return template.replace(/\{number\}/g, String(number));
}

/**
 * Appends `close #N` statements to the pull request body.
 * The block is idempotent: references already covered by a closing keyword are skipped.
 */
export function appendCloseKeywords(params: {
  body: string;
  numbers: number[];
  template: string;
}): string {
  const unique = [...new Set(params.numbers)].filter((number) => Number.isSafeInteger(number) && number > 0);
  if (unique.length === 0) {
    return params.body;
  }

  const existingBody = params.body ?? "";
  const alreadyClosed = new Set<number>();
  for (const reference of extractIssueReferences(existingBody, "body")) {
    if (reference.hasCloseKeyword) {
      alreadyClosed.add(reference.number);
    }
  }

  const appended = unique
    .filter((number) => !alreadyClosed.has(number))
    .map((number) => renderCloseKeyword(params.template, number));

  if (appended.length === 0) {
    return existingBody;
  }

  const separator = existingBody.trim().length > 0 ? "\n\n" : "";
  return `${existingBody.trimEnd()}${separator}${appended.join("\n")}`;
}

export function buildIssueReferencePattern(number: number): RegExp {
  return new RegExp(`#${String(number).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}
