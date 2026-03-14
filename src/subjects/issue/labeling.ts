import type { IssueContext, LabelingConfig, ValidationOutcome } from "../../core/types.js";

function includesKeyword(text: string, keyword: string, caseSensitive: boolean): boolean {
  if (caseSensitive) {
    return text.includes(keyword);
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
}

export function computeManagedLabels(params: {
  issue: IssueContext;
  config: LabelingConfig;
  validation: ValidationOutcome;
  preservedLabels?: string[];
}): {
  desiredLabels: string[];
  labelsToAdd: string[];
  labelsToRemove: string[];
} {
  const currentLabels = new Set(params.issue.labels);
  const desired = new Set<string>(params.preservedLabels ?? []);

  if (params.validation.valid) {
    for (const label of params.validation.desiredLabels) {
      desired.add(label);
    }
  } else {
    for (const label of params.validation.invalidLabels) {
      desired.add(label);
    }
  }

  const sectionsText = Object.values(params.validation.parsed.sections).join("\n");
  for (const rule of params.config.keywordRules) {
    const haystack = rule.fields.map((field) => {
      if (field === "title") {
        return params.issue.title;
      }
      if (field === "body") {
        return params.issue.body;
      }
      return sectionsText;
    }).join("\n");

    const matched = rule.keywords.some((keyword) => includesKeyword(haystack, keyword, rule.caseSensitive));
    if (matched) {
      for (const label of rule.labels) {
        desired.add(label);
      }
    }
  }

  const labelsToAdd = [...desired].filter((label) => !currentLabels.has(label));
  const labelsToRemove = params.config.managed.filter((label) => currentLabels.has(label) && !desired.has(label));

  return {
    desiredLabels: [...desired],
    labelsToAdd,
    labelsToRemove
  };
}
