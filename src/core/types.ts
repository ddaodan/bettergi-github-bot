export type CommentMode = "zh" | "zh-en";

export type IssueState = "open" | "closed";

export interface LabelDefinition {
  color: string;
  description?: string;
}

export interface SectionRule {
  id: string;
  aliases: string[];
  placeholderHints?: string[];
}

export interface IssueTemplateConfig {
  key: string;
  detect: {
    markers: string[];
  };
  requiredSections: SectionRule[];
  labels: {
    whenValid: string[];
    whenInvalid: string[];
  };
}

export interface DuplicateThresholds {
  exact: number;
  highConfidence: number;
  reviewMin: number;
}

export interface DuplicateDetectionConfig {
  enabled: boolean;
  bypassLabels: string[];
  duplicateLabel: string;
  searchResultLimit: number;
  candidateLimit: number;
  aiReviewMaxCandidates: number;
  thresholds: DuplicateThresholds;
}

export interface ValidationConfig {
  enabled: boolean;
  fallbackTemplateKey?: string;
  commentAnchor: string;
  templates: IssueTemplateConfig[];
  duplicateDetection: DuplicateDetectionConfig;
}

export interface KeywordRule {
  keywords: string[];
  labels: string[];
  fields: Array<"title" | "body" | "sections">;
  caseSensitive: boolean;
}

export interface LabelingConfig {
  enabled: boolean;
  autoCreateMissing: boolean;
  managed: string[];
  definitions: Record<string, LabelDefinition>;
  keywordRules: KeywordRule[];
}

export interface AiHelpConfig {
  enabled: boolean;
  triggerLabels: string[];
  commentAnchor: string;
}

export interface ProviderConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiStyle: "auto" | "responses" | "chat_completions";
  timeoutMs: number;
}

export interface RuntimeConfig {
  languageMode: "auto" | "zh" | "zh-en";
  dryRun: boolean;
}

export interface RepoBotConfig {
  runtime: RuntimeConfig;
  providers: {
    openAiCompatible: ProviderConfig;
  };
  issues: {
    validation: ValidationConfig;
    labeling: LabelingConfig;
    aiHelp: AiHelpConfig;
  };
  pullRequests: {
    review: {
      enabled: boolean;
    };
    labeling: {
      enabled: boolean;
    };
    summary: {
      enabled: boolean;
    };
  };
}

export interface RepositorySubjectContext {
  kind: "issue" | "pull_request";
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  labels: string[];
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  action: string;
}

export interface IssueContext extends RepositorySubjectContext {
  kind: "issue";
}

export interface PullRequestContext extends RepositorySubjectContext {
  kind: "pull_request";
}

export interface ParsedIssue {
  marker?: string;
  sections: Record<string, string>;
  headings: string[];
}

export interface ValidationOutcome {
  executed: boolean;
  valid: boolean;
  template?: IssueTemplateConfig;
  parsed: ParsedIssue;
  missingSections: Array<{
    id: string;
    aliases: string[];
  }>;
  desiredLabels: string[];
  invalidLabels: string[];
  commentBody?: string;
}

export interface DuplicateCandidate {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: IssueState;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateDecision {
  executed: boolean;
  skippedReason?: string;
  duplicateOf?: DuplicateCandidate;
  confidence?: number;
  aiReviewed?: boolean;
}

export interface AiHelpResult {
  summary: string;
  possibleCauses: string[];
  troubleshootingSteps: string[];
  missingInformation: string[];
}

export interface DuplicateReviewResult {
  duplicate: boolean;
  confidence: number;
  reason: string;
}
