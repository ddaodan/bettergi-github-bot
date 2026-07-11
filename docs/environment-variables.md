# 环境变量配置

每个 Repo Bot 配置字段都有独立环境变量。未设置或值为空时保留 YAML 配置；字符串字段如需显式清空，可设置为 `""`。

- 布尔值支持 `true`、`false`、`1`、`0`、`yes`、`no`、`on`、`off`。
- 数字直接填写十进制值。
- 数组和对象使用 JSON。
- `REPO_BOT_AI_API_KEY`、`REPO_BOT_GITHUB_APP_PRIVATE_KEY` 应使用 GitHub Secrets，其他值通常使用 GitHub Variables。

## Runtime

| 配置字段 | 环境变量 | 类型 |
| --- | --- | --- |
| `runtime.languageMode` | `REPO_BOT_RUNTIME_LANGUAGE_MODE` | 字符串 |
| `runtime.dryRun` | `REPO_BOT_RUNTIME_DRY_RUN` | 布尔值 |

## AI Provider

| 配置字段 | 环境变量 | 类型 |
| --- | --- | --- |
| `providers.openAiCompatible.enabled` | `REPO_BOT_AI_ENABLED` | 布尔值 |
| `providers.openAiCompatible.baseUrl` | `REPO_BOT_AI_BASE_URL` | 字符串 |
| `providers.openAiCompatible.model` | `REPO_BOT_AI_MODEL` | 字符串 |
| `providers.openAiCompatible.apiStyle` | `REPO_BOT_AI_API_STYLE` | 字符串 |
| `providers.openAiCompatible.timeoutMs` | `REPO_BOT_AI_TIMEOUT_MS` | 数字 |

## Issue Processing

| 配置字段 | 环境变量 | 类型 |
| --- | --- | --- |
| `issues.autoProcessing.skipCreatedBefore` | `REPO_BOT_ISSUES_AUTO_PROCESSING_SKIP_CREATED_BEFORE` | 字符串 |
| `issues.titleGeneration.enabled` | `REPO_BOT_ISSUES_TITLE_GENERATION_ENABLED` | 布尔值 |
| `issues.titleGeneration.maxLength` | `REPO_BOT_ISSUES_TITLE_GENERATION_MAX_LENGTH` | 数字 |
| `issues.titleGeneration.detectMismatch` | `REPO_BOT_ISSUES_TITLE_GENERATION_DETECT_MISMATCH` | 布尔值 |
| `issues.titleGeneration.mismatchConfidence` | `REPO_BOT_ISSUES_TITLE_GENERATION_MISMATCH_CONFIDENCE` | 数字 |
| `issues.titleGeneration.placeholderTitles` | `REPO_BOT_ISSUES_TITLE_GENERATION_PLACEHOLDER_TITLES` | JSON 数组 |

## Validation And Duplicates

| 配置字段 | 环境变量 | 类型 |
| --- | --- | --- |
| `issues.validation.enabled` | `REPO_BOT_ISSUES_VALIDATION_ENABLED` | 布尔值 |
| `issues.validation.fallbackTemplateKey` | `REPO_BOT_ISSUES_VALIDATION_FALLBACK_TEMPLATE_KEY` | 字符串 |
| `issues.validation.commentAnchor` | `REPO_BOT_ISSUES_VALIDATION_COMMENT_ANCHOR` | 字符串 |
| `issues.validation.templates` | `REPO_BOT_ISSUES_VALIDATION_TEMPLATES` | JSON 数组 |
| `issues.validation.duplicateDetection.enabled` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_ENABLED` | 布尔值 |
| `issues.validation.duplicateDetection.bypassLabels` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_BYPASS_LABELS` | JSON 数组 |
| `issues.validation.duplicateDetection.duplicateLabel` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_DUPLICATE_LABEL` | 字符串 |
| `issues.validation.duplicateDetection.searchResultLimit` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_SEARCH_RESULT_LIMIT` | 数字 |
| `issues.validation.duplicateDetection.candidateLimit` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_CANDIDATE_LIMIT` | 数字 |
| `issues.validation.duplicateDetection.aiReviewMaxCandidates` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_AI_REVIEW_MAX_CANDIDATES` | 数字 |
| `issues.validation.duplicateDetection.thresholds.exact` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_THRESHOLDS_EXACT` | 数字 |
| `issues.validation.duplicateDetection.thresholds.highConfidence` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_THRESHOLDS_HIGH_CONFIDENCE` | 数字 |
| `issues.validation.duplicateDetection.thresholds.reviewMin` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_THRESHOLDS_REVIEW_MIN` | 数字 |
| `issues.validation.duplicateDetection.similarityComment.enabled` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_SIMILARITY_COMMENT_ENABLED` | 布尔值 |
| `issues.validation.duplicateDetection.similarityComment.commentAnchor` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_SIMILARITY_COMMENT_COMMENT_ANCHOR` | 字符串 |
| `issues.validation.duplicateDetection.similarityComment.minScore` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_SIMILARITY_COMMENT_MIN_SCORE` | 数字 |
| `issues.validation.duplicateDetection.similarityComment.maxCandidates` | `REPO_BOT_ISSUES_VALIDATION_DUPLICATE_DETECTION_SIMILARITY_COMMENT_MAX_CANDIDATES` | 数字 |

## Labeling

| 配置字段 | 环境变量 | 类型 |
| --- | --- | --- |
| `issues.labeling.enabled` | `REPO_BOT_ISSUES_LABELING_ENABLED` | 布尔值 |
| `issues.labeling.autoCreateMissing` | `REPO_BOT_ISSUES_LABELING_AUTO_CREATE_MISSING` | 布尔值 |
| `issues.labeling.managed` | `REPO_BOT_ISSUES_LABELING_MANAGED` | JSON 数组 |
| `issues.labeling.definitions` | `REPO_BOT_ISSUES_LABELING_DEFINITIONS` | JSON 对象 |
| `issues.labeling.keywordRules` | `REPO_BOT_ISSUES_LABELING_KEYWORD_RULES` | JSON 数组 |
| `issues.labeling.aiClassification.enabled` | `REPO_BOT_ISSUES_LABELING_AI_CLASSIFICATION_ENABLED` | 布尔值 |
| `issues.labeling.aiClassification.maxLabels` | `REPO_BOT_ISSUES_LABELING_AI_CLASSIFICATION_MAX_LABELS` | 数字 |
| `issues.labeling.aiClassification.minConfidence` | `REPO_BOT_ISSUES_LABELING_AI_CLASSIFICATION_MIN_CONFIDENCE` | 数字 |
| `issues.labeling.aiClassification.include` | `REPO_BOT_ISSUES_LABELING_AI_CLASSIFICATION_INCLUDE` | JSON 数组 |
| `issues.labeling.aiClassification.exclude` | `REPO_BOT_ISSUES_LABELING_AI_CLASSIFICATION_EXCLUDE` | JSON 数组 |
| `issues.labeling.aiClassification.prompt` | `REPO_BOT_ISSUES_LABELING_AI_CLASSIFICATION_PROMPT` | 字符串 |
| `issues.labeling.aiClassification.sourceRepository.owner` | `REPO_BOT_ISSUES_LABELING_AI_CLASSIFICATION_SOURCE_REPOSITORY_OWNER` | 字符串 |
| `issues.labeling.aiClassification.sourceRepository.repo` | `REPO_BOT_ISSUES_LABELING_AI_CLASSIFICATION_SOURCE_REPOSITORY_REPO` | 字符串 |

## AI Help

| 配置字段 | 环境变量 | 类型 |
| --- | --- | --- |
| `issues.aiHelp.enabled` | `REPO_BOT_ISSUES_AI_HELP_ENABLED` | 布尔值 |
| `issues.aiHelp.triggerLabels` | `REPO_BOT_ISSUES_AI_HELP_TRIGGER_LABELS` | JSON 数组 |
| `issues.aiHelp.commentAnchor` | `REPO_BOT_ISSUES_AI_HELP_COMMENT_ANCHOR` | 字符串 |
| `issues.aiHelp.projectContext.enabled` | `REPO_BOT_ISSUES_AI_HELP_PROJECT_CONTEXT_ENABLED` | 布尔值 |
| `issues.aiHelp.projectContext.includeRepositoryMetadata` | `REPO_BOT_ISSUES_AI_HELP_PROJECT_CONTEXT_INCLUDE_REPOSITORY_METADATA` | 布尔值 |
| `issues.aiHelp.projectContext.includeReadme` | `REPO_BOT_ISSUES_AI_HELP_PROJECT_CONTEXT_INCLUDE_README` | 布尔值 |
| `issues.aiHelp.projectContext.readmeMaxChars` | `REPO_BOT_ISSUES_AI_HELP_PROJECT_CONTEXT_README_MAX_CHARS` | 数字 |
| `issues.aiHelp.projectContext.profile.name` | `REPO_BOT_ISSUES_AI_HELP_PROJECT_CONTEXT_PROFILE_NAME` | 字符串 |
| `issues.aiHelp.projectContext.profile.aliases` | `REPO_BOT_ISSUES_AI_HELP_PROJECT_CONTEXT_PROFILE_ALIASES` | JSON 数组 |
| `issues.aiHelp.projectContext.profile.summary` | `REPO_BOT_ISSUES_AI_HELP_PROJECT_CONTEXT_PROFILE_SUMMARY` | 字符串 |
| `issues.aiHelp.projectContext.profile.techStack` | `REPO_BOT_ISSUES_AI_HELP_PROJECT_CONTEXT_PROFILE_TECH_STACK` | JSON 数组 |

## Commands

| 配置字段 | 环境变量 | 类型 |
| --- | --- | --- |
| `issues.commands.enabled` | `REPO_BOT_ISSUES_COMMANDS_ENABLED` | 布尔值 |
| `issues.commands.mentions` | `REPO_BOT_ISSUES_COMMANDS_MENTIONS` | JSON 数组 |
| `issues.commands.access` | `REPO_BOT_ISSUES_COMMANDS_ACCESS` | 字符串 |
| `issues.commands.fix.enabled` | `REPO_BOT_ISSUES_COMMANDS_FIX_ENABLED` | 布尔值 |
| `issues.commands.fix.commentAnchor` | `REPO_BOT_ISSUES_COMMANDS_FIX_COMMENT_ANCHOR` | 字符串 |
| `issues.commands.refresh.enabled` | `REPO_BOT_ISSUES_COMMANDS_REFRESH_ENABLED` | 布尔值 |

## Pull Requests

| 配置字段 | 环境变量 | 类型 |
| --- | --- | --- |
| `pullRequests.review.enabled` | `REPO_BOT_PULL_REQUESTS_REVIEW_ENABLED` | 布尔值 |
| `pullRequests.labeling.enabled` | `REPO_BOT_PULL_REQUESTS_LABELING_ENABLED` | 布尔值 |
| `pullRequests.summary.enabled` | `REPO_BOT_PULL_REQUESTS_SUMMARY_ENABLED` | 布尔值 |

## 优先级

配置覆盖顺序为：

1. `.github/repo-bot.yml`
2. `config-overrides-json` Action 输入
3. `REPO_BOT_CONFIG_OVERRIDES_JSON` 兼容变量
4. 本文列出的独立 `REPO_BOT_*` 配置变量
5. `dry-run` Action 输入
