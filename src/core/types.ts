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
  transferExempt?: boolean;
}

export interface IssueTemplateConfig {
  key: string;
  issueType?: string;
  detect: {
    markers: string[];
    titlePrefixes: string[];
    formSignatures?: string[];
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

export interface ValidationAutoCloseConfig {
  enabled: boolean;
  reopenWhenValid: boolean;
}

export interface ValidationConfig {
  enabled: boolean;
  fallbackTemplateKey?: string;
  commentAnchor: string;
  templates: IssueTemplateConfig[];
  duplicateDetection: DuplicateDetectionConfig;
  autoClose: ValidationAutoCloseConfig;
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

export interface IssueCodeContextConfig {
  source: "workspace" | "github";
  includeInAiHelp: boolean;
  includeInFix: boolean;
  indexPath: string;
  indexRoot: string;
  categorySectionAliases: string[];
  nameSectionAliases: string[];
  pathSectionAliases: string[];
  categoryRoots: Record<string, string[]>;
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

export type SubIssueProcessingMode = "relaxed" | "skip" | "normal";

export interface SubIssueConfig {
  mode: SubIssueProcessingMode;
  includeParentContext: boolean;
  parentBodyMaxChars: number;
}

export interface IssueTitleGenerationConfig {
  enabled: boolean;
  maxLength: number;
  detectMismatch: boolean;
  mismatchConfidence: number;
  placeholderTitles: string[];
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
    subIssues: SubIssueConfig;
    titleGeneration: IssueTitleGenerationConfig;
    validation: ValidationConfig;
    labeling: LabelingConfig;
    codeContext: IssueCodeContextConfig;
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
    autoProcessing: PullRequestAutoProcessingConfig;
    pathLabels: PullRequestPathLabelConfig;
    locationCheck: PullRequestLocationCheckConfig;
    issueLink: PullRequestIssueLinkConfig;
  };
}

export interface PullRequestAutoProcessingConfig {
  /** Skip pull requests created before this cutoff. Empty string or "auto" disables the cutoff. */
  skipCreatedBefore: string;
}

export interface PullRequestPathLabelConfig {
  enabled: boolean;
  /** When true, labels that this feature is responsible for get removed when no longer matched. */
  managed: boolean;
  /**
   * Ordered matching rules. The first rule whose path prefixes match a changed file claims that file.
   * Later, more specific rules should come first when prefixes overlap.
   */
  rules: PullRequestPathLabelRule[];
  /** Label applied when only documentation files changed. */
  documentationLabel: string;
  /** Extra label applied when files fall outside every configured rule. */
  unmatchedLabel: string;
  commentAnchor: string;
}

export interface PullRequestPathLabelRule {
  label: string;
  pathPrefixes: string[];
  /**
   * When true, a changed file only matches this rule if it lives inside a sub-directory
   * of one of the prefixes (e.g. `repo/js/<script>/...`). A stray file directly under the
   * prefix (`repo/js/xxx.json`) is not counted, so it is not mislabelled as a script.
   */
  requireSubdirectory?: boolean;
}

export interface PullRequestLocationCheckConfig {
  enabled: boolean;
  commentAnchor: string;
  /** Paths that are always acceptable regardless of their owning category. */
  allowedPaths: string[];
  /** Files inside these roots are accepted as script resources even when they live outside their category root. */
  scriptRoots: string[];
  /** File extensions that identify each category when found outside of that category's path prefixes. */
  fileKindRules: PullRequestFileKindRule[];
  /** Sub-rules derived from the repository README submission rules. */
  rules: PullRequestLocationRuleConfig;
}

export interface PullRequestFileKindRule {
  /** Human readable category shown in comments (e.g. 战斗策略). */
  category: string;
  /** Directories where files of this kind may live; any one of them is acceptable. */
  expectedLocations: string[];
  extensions: string[];
}

export interface PullRequestLocationRuleConfig {
  /** 地图追踪路线文件名格式：编号-材料名称-[区域]-[二级区域]-二级子区域-数量 */
  pathingFileNamePattern: string;
  pathingRequireReadme: boolean;
  jsFolderNameNoSpace: boolean;
  jsFolderNamePattern: string;
}

export interface PullRequestIssueLinkConfig {
  enabled: boolean;
  /** Comment anchor used for the issue-link summary comment. */
  commentAnchor: string;
  /** When true, a missing close keyword is repaired by appending the keyword to the pull request body. */
  appendCloseKeyword: boolean;
  /** Keyword template; `{number}` is replaced with the issue number. */
  closeKeywordTemplate: string;
  /** The bot adds this label when it links issues on its own initiative. */
  linkedLabel: string;
  /** Issue references must resolve to issues in the same repository. */
  requireSameRepository: boolean;
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
  actorLogin?: string;
  actorType?: string;
}

export interface IssueContext extends RepositorySubjectContext {
  kind: "issue";
  stateReason?: string | null;
  isSubIssue?: boolean;
  isTransferred?: boolean;
  typeName?: string | null;
  parentRelation?: "sub_issue" | "comment_derived";
  parentIssueUrl?: string | null;
  parentIssue?: IssueParentContext;
}

export interface IssueParentContext {
  owner: string;
  repo: string;
  number: number;
  title: string;
  bodyExcerpt: string;
  state: IssueState;
  labels: string[];
  htmlUrl: string;
}

export type IssueWorkflowTrigger =
  | "issue_opened"
  | "issue_edited"
  | "issue_reopened"
  | "command_refresh";

export interface PullRequestContext extends RepositorySubjectContext {
  kind: "pull_request";
  isDraft: boolean;
  merged: boolean;
  baseBranch: string;
  headBranch: string;
  /** Lazily populated by the gateway when changed files are requested. */
  changedFiles?: PullRequestFile[];
}

export interface PullRequestFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
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

export interface IssueAttachmentReference {
  url: string;
  filename: string;
}

export interface IssueTextAttachment extends IssueAttachmentReference {
  content: string;
  truncated: boolean;
}

export interface ParsedIssue {
  marker?: string;
  raw: string;
  sections: Record<string, string>;
  headings: string[];
  images: IssueImageReference[];
  attachments: IssueAttachmentReference[];
  textAttachments: IssueTextAttachment[];
}

export interface ValidationOutcome {
  executed: boolean;
  valid: boolean;
  template?: IssueTemplateConfig;
  templateMatched: boolean;
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
  parentIssueUrl?: string | null;
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
  summaryEn?: string;
  possibleCauses: string[];
  possibleCausesEn?: string[];
  troubleshootingSteps: string[];
  troubleshootingStepsEn?: string[];
  missingInformation: string[];
  missingInformationEn?: string[];
}

export interface FixSuggestionCandidateFile {
  path: string;
  reason: string;
  reasonEn?: string;
}

export interface RepositoryCodeContextFile {
  path: string;
  reason: string;
  excerpt: string;
}

export interface RepositoryCodeContextTarget {
  path: string;
  name: string;
  version?: string;
  author?: string;
  description?: string;
}

export type RepositoryCodeContextResolutionStatus =
  | "resolved"
  | "ambiguous"
  | "not_found"
  | "unavailable";

export interface RepositoryCodeContextResolution {
  status: RepositoryCodeContextResolutionStatus;
  query: string;
  candidatePaths: string[];
}

export interface RepositoryCodeContext {
  files: RepositoryCodeContextFile[];
  fallbackUsed: boolean;
  targets?: RepositoryCodeContextTarget[];
  resolution?: RepositoryCodeContextResolution;
}

export interface FixSuggestionResult {
  summary: string;
  summaryEn?: string;
  candidateFiles: FixSuggestionCandidateFile[];
  changeSuggestions: string[];
  changeSuggestionsEn?: string[];
  patchDraft: string;
  verificationSteps: string[];
  verificationStepsEn?: string[];
  risks: string[];
  risksEn?: string[];
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

export interface IssueTitleSuggestion {
  shouldReplace: boolean;
  confidence: number;
  title: string;
  reason: string;
}
