import type { IssueImageReference, IssueTemplateConfig, ParsedIssue, SectionRule } from "../../core/types.js";

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[*_`:#]/g, "").trim();
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().trim();
}

export function extractTemplateMarker(body: string): string | undefined {
  const match = body.match(/<!--\s*issue-template:\s*([a-zA-Z0-9_-]+)\s*-->/i);
  return match?.[1];
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    const name = match[1]?.toLowerCase();
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    if (!name) {
      continue;
    }
    attributes[name] = decodeHtmlEntity(rawValue.trim());
  }

  return attributes;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function extractIssueImages(body: string): IssueImageReference[] {
  const images: IssueImageReference[] = [];
  const seen = new Set<string>();
  const addImage = (url: string, altText = ""): void => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl || !isHttpUrl(normalizedUrl) || seen.has(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);
    images.push({
      url: normalizedUrl,
      altText: altText.trim()
    });
  };

  const markdownImagePattern = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownImagePattern.exec(body)) !== null) {
    addImage(markdownMatch[2] ?? "", markdownMatch[1] ?? "");
  }

  const htmlImagePattern = /<img\b[^>]*>/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlImagePattern.exec(body)) !== null) {
    const attributes = parseHtmlAttributes(htmlMatch[0]);
    addImage(attributes.src ?? "", attributes.alt ?? "");
  }

  const githubAttachmentPattern = /https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+/gi;
  let attachmentMatch: RegExpExecArray | null;
  while ((attachmentMatch = githubAttachmentPattern.exec(body)) !== null) {
    addImage(attachmentMatch[0] ?? "");
  }

  return images;
}

export function parseIssueBody(body: string): ParsedIssue {
  const sections: Record<string, string> = {};
  const headings: string[] = [];
  const lines = body.split(/\r?\n/);
  let currentHeading = "__root__";
  let buffer: string[] = [];

  const flush = (): void => {
    sections[currentHeading] = buffer.join("\n").trim();
    buffer = [];
  };

  for (const line of lines) {
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (match?.[2]) {
      flush();
      currentHeading = normalizeHeading(match[2]);
      headings.push(match[2].trim());
      continue;
    }

    buffer.push(line);
  }

  flush();

  return {
    marker: extractTemplateMarker(body),
    sections,
    headings,
    images: extractIssueImages(body)
  };
}

function scoreTemplateBySections(parsed: ParsedIssue, template: IssueTemplateConfig): number {
  if (template.requiredSections.length === 0) {
    return 0;
  }

  let matched = 0;
  for (const rule of template.requiredSections) {
    const aliases = rule.aliases.map(normalizeHeading);
    if (aliases.some((alias) => alias in parsed.sections)) {
      matched += 1;
    }
  }

  if (matched === 0) {
    return 0;
  }

  return matched / template.requiredSections.length + matched / 1000;
}

export function matchTemplate(
  parsed: ParsedIssue,
  templates: IssueTemplateConfig[],
  fallbackTemplateKey?: string,
  title?: string
): IssueTemplateConfig | undefined {
  if (parsed.marker) {
    const byMarker = templates.find((template) => template.detect.markers.includes(parsed.marker!));
    if (byMarker) {
      return byMarker;
    }
  }

  const normalizedTitle = normalizeTitle(title ?? "");
  if (normalizedTitle) {
    const byTitlePrefix = templates.find((template) => template.detect.titlePrefixes
      .some((prefix) => normalizedTitle.startsWith(normalizeTitle(prefix))));
    if (byTitlePrefix) {
      return byTitlePrefix;
    }
  }

  const rankedTemplates = templates
    .map((template) => ({
      template,
      score: scoreTemplateBySections(parsed, template)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (rankedTemplates.length > 0) {
    return rankedTemplates[0]?.template;
  }

  if (fallbackTemplateKey) {
    return templates.find((template) => template.key === fallbackTemplateKey);
  }

  return templates[0];
}

export function getSectionContent(parsed: ParsedIssue, rule: SectionRule): string {
  const aliases = rule.aliases.map(normalizeHeading);
  for (const alias of aliases) {
    if (alias in parsed.sections) {
      return parsed.sections[alias] ?? "";
    }
  }
  return "";
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}
