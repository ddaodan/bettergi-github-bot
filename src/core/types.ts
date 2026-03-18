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
    titlePrefixes: string[];
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

export interface SimilarIssueCommentConfig {
  enabled: boolean;
  commentAnchor: string;
  minScore: number;
  maxCandidates: number;
}

export interface DuplicateDetectionConfig {
  enabled: boolean;
  bypassLabels: string[];
  duplicateLabel: string;
  searchResultLimit: number;
  candidateLimit: number;
  aiReviewMaxCandidates: number;
  thresholds: DuplicateThresholds;
  similarityComment: SimilarIssueCommentConfig;
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

export interface LabelCatalogRepository {
  owner: string;
  repo: string;
}

export interface LabelingAiClassificationConfig {
  enabled: boolean;
  maxLabels: number;
  minConfidence: number;
  include: string[];
  exclude: string[];
  prompt: string;
  sourceRepository: LabelCatalogRepository;
}

export interface LabelingConfig {
  enabled: boolean;
  autoCreateMissing: boolean;
  managed: string[];
  definitions: Record<string, LabelDefinition>;
  keywordRules: KeywordRule[];
  aiClassification: LabelingAiClassificationConfig;
}

export interface ProjectProfile {
  name: string;
  aliases: string[];
  summary: string;
  techStack: string[];
}

export interface ProjectContextConfig {
  enabled: boolean;
  includeRepositoryMetadata: boolean;
  includeReadme: boolean;
  readmeMaxChars: number;
  profile: ProjectProfile;
}

export interface AiHelpConfig {
  enabled: boolean;
  triggerLabels: string[];
  commentAnchor: string;
  projectContext: ProjectContextConfig;
}

export interface IssueCommandsFixConfig {
  enabled: boolean;
  commentAnchor: string;
}

export interface IssueCommandsRefreshConfig {
  enabled: boolean;
}

export interface IssueCommandsConfig {
  enabled: boolean;
  mentions: string[];
  access: "collaborators";
  fix: IssueCommandsFixConfig;
  refresh: IssueCommandsRefreshConfig;
}

export interface IssueAutoProcessingConfig {
  skipCreatedBefore: string;
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
    autoProcessing: IssueAutoProcessingConfig;
    validation: ValidationConfig;
    labeling: LabelingConfig;
    aiHelp: AiHelpConfig;
    commands: IssueCommandsConfig;
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

export type IssueWorkflowTrigger =
  | "issue_opened"
  | "issue_edited"
  | "issue_reopened"
  | "issue_labeled"
  | "command_refresh";

export interface PullRequestContext extends RepositorySubjectContext {
  kind: "pull_request";
}

export type IssueCommandType = "fix" | "refresh";

export interface IssueCommentContext {
  issue: IssueContext;
  commentId: number;
  commentBody: string;
  commentAuthorLogin: string;
  commentAuthorType: string;
  commentAuthorAssociation: string;
  action: string;
}

export interface IssueCommentCommandContext extends IssueCommentContext {
  command: IssueCommandType;
  commandLine: string;
}

export interface RepositoryMetadata {
  owner: string;
  repo: string;
  fullName: string;
  description: string;
  topics: string[];
  homepage: string;
}

export interface RepositoryAiContext extends RepositoryMetadata {
  issueUrl: string;
  templateKey: string;
  readmeExcerpt: string;
  projectProfile: ProjectProfile;
}

export interface IssueImageReference {
  url: string;
  altText: string;
}

export interface ParsedIssue {
  marker?: string;
  sections: Record<string, string>;
  headings: string[];
  images: IssueImageReference[];
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

export interface SimilarIssueCandidate {
  candidate: DuplicateCandidate;
  score: number;
}

export interface DuplicateDecision {
  executed: boolean;
  skippedReason?: string;
  duplicateOf?: DuplicateCandidate;
  confidence?: number;
  aiReviewed?: boolean;
  similarIssues?: SimilarIssueCandidate[];
}

export interface AiHelpResult {
  summary: string;
  possibleCauses: string[];
  troubleshootingSteps: string[];
  missingInformation: string[];
}

export interface FixSuggestionCandidateFile {
  path: string;
  reason: string;
}

export interface RepositoryCodeContextFile {
  path: string;
  reason: string;
  excerpt: string;
}

export interface RepositoryCodeContext {
  files: RepositoryCodeContextFile[];
  fallbackUsed: boolean;
}

export interface FixSuggestionResult {
  summary: string;
  candidateFiles: FixSuggestionCandidateFile[];
  changeSuggestions: string[];
  patchDraft: string;
  verificationSteps: string[];
  risks: string[];
}

export interface DuplicateReviewResult {
  duplicate: boolean;
  confidence: number;
  reason: string;
}

export interface LabelClassificationResult {
  name: string;
  confidence: number;
  reason: string;
}
