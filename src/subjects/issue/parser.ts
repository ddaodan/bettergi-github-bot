import type { IssueTemplateConfig, ParsedIssue, SectionRule } from "../../core/types.js";

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[*_`:#]/g, "").trim();
}

export function extractTemplateMarker(body: string): string | undefined {
  const match = body.match(/<!--\s*issue-template:\s*([a-zA-Z0-9_-]+)\s*-->/i);
  return match?.[1];
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
    headings
  };
}

export function matchTemplate(parsed: ParsedIssue, templates: IssueTemplateConfig[], fallbackTemplateKey?: string): IssueTemplateConfig | undefined {
  if (parsed.marker) {
    const byMarker = templates.find((template) => template.detect.markers.includes(parsed.marker!));
    if (byMarker) {
      return byMarker;
    }
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
