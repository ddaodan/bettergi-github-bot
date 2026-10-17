export interface PullRequestIssueReference {
  number: number;
  /** How the reference was found in the pull request text. */
  source: "title" | "body" | "commit";
  /** True when the surrounding text already contains a closing keyword. */
  hasCloseKeyword: boolean;
}

/** Short connectors allowed between a closing keyword and the issue reference. */
const CONNECTOR_PATTERN = /^[\s:：,，、]+$/;

function stripMarkdownLinks(value: string): string {
  return value.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/**
 * Keywords that make GitHub close an issue when the pull request is merged.
 * Deliberately narrow: descriptive verbs such as "解决 #12 的问题" or
 * "fix the crash in #12" do NOT count, because those are exactly the cases
 * where the closing keyword still needs to be added.
 */
const GITHUB_CLOSING_KEYWORDS = [
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved"
];

/** Chinese keywords that read as an explicit closing statement. */
const CHINESE_CLOSING_KEYWORDS = ["关闭", "修复", "解决"];

/**
 * For Chinese keywords, only whitespace, punctuation or a very short connector
 * may sit between the keyword and the reference. This keeps 「解决 #12 的问题」
 * and 「解决这个 #12 的问题」 from counting as explicit closing statements.
 */
const CHINESE_CONNECTOR_PATTERN = /^[\s:：,，、]*$/;

function findLastKeywordEnd(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let closestEnd = -1;

  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    let index = lower.indexOf(needle);
    while (index >= 0) {
      const candidateEnd = index + needle.length;
      // Require a word boundary for latin keywords so "prefix" does not match "fix".
      const before = index === 0 ? " " : lower[index - 1] ?? " ";
      const isLatin = /[a-z]/.test(needle);
      const boundaryOk = !isLatin || !/[a-z]/.test(before);
      if (boundaryOk && candidateEnd > closestEnd) {
        closestEnd = candidateEnd;
      }
      index = lower.indexOf(needle, index + 1);
    }
  }

  return closestEnd;
}

/**
 * Determines whether the text immediately preceding an issue reference forms an
 * explicit closing statement such as "close #12", "fixes #12" or "修复 #12".
 *
 * Only the closest keyword counts, everything between the keyword and the reference
 * must be whitespace/punctuation, and the keyword must not be followed by a
 * descriptive suffix (e.g. "解决 #12 的问题" is not a closing statement).
 */
/**
 * Text that follows a Chinese keyword's reference and turns it into a description.
 * e.g. 「解决 #12 的问题」/「修复 #12 中提到的异常」are descriptions, not closing statements.
 */
const CHINESE_DESCRIPTIVE_AFTER_PATTERN = /^\s*(?:的|了|中所?|后|时|问题|异常|情况|功能|内容|报错|闪退|崩溃)/;

function hasCloseKeywordBefore(prefix: string, suffix = ""): boolean {
  const normalized = stripMarkdownLinks(prefix);
  const withoutLinks = normalized.replace(/\s+/g, " ");

  const latinEnd = findLastKeywordEnd(withoutLinks, GITHUB_CLOSING_KEYWORDS);

  // Chinese keywords must be directly followed by the reference (punctuation allowed),
  // and the reference must not be followed by a descriptive phrase.
  let chineseEnd = -1;
  for (const keyword of CHINESE_CLOSING_KEYWORDS) {
    const index = withoutLinks.lastIndexOf(keyword);
    if (index < 0) {
      continue;
    }
    const after = withoutLinks.slice(index + keyword.length);
    if (!CHINESE_CONNECTOR_PATTERN.test(after)) {
      continue;
    }
    if (suffix && CHINESE_DESCRIPTIVE_AFTER_PATTERN.test(suffix)) {
      continue;
    }
    const end = index + keyword.length;
    if (end > chineseEnd) {
      chineseEnd = end;
    }
  }

  const closestEnd = Math.max(latinEnd, chineseEnd);
  if (closestEnd < 0) {
    return false;
  }

  const between = withoutLinks.slice(closestEnd);
  if (between.trim().length === 0) {
    return true;
  }
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

    // Inspect the same line around the reference, bounded to a reasonable window.
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const lineEnd = text.indexOf("\n", match.index);
    const prefix = text.slice(Math.max(lineStart, match.index - 120), match.index);
    const suffix = text.slice(match.index, lineEnd < 0 ? Math.min(text.length, match.index + 120) : lineEnd);
    // Drop the reference itself so the descriptive check looks at what follows "#12".
    const suffixAfterReference = suffix.replace(/^#\d+\b/, "");

    references.push({
      number,
      source,
      hasCloseKeyword: hasCloseKeywordBefore(prefix, suffixAfterReference)
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
