// src/index.ts
import * as core6 from "@actions/core";

// src/config/loadConfig.ts
import { readFile } from "fs/promises";
import path from "path";
import yaml from "js-yaml";

// src/config/schema.ts
import { z } from "zod";
var sectionRuleSchema = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1),
  placeholderHints: z.array(z.string().min(1)).default([])
});
var templateSchema = z.object({
  key: z.string().min(1),
  detect: z.object({
    markers: z.array(z.string().min(1)).default([])
  }),
  requiredSections: z.array(sectionRuleSchema).default([]),
  labels: z.object({
    whenValid: z.array(z.string().min(1)).default([]),
    whenInvalid: z.array(z.string().min(1)).default([])
  })
});
var duplicateDetectionSchema = z.object({
  enabled: z.boolean().default(true),
  bypassLabels: z.array(z.string().min(1)).default(["no-auto-duplicate"]),
  duplicateLabel: z.string().min(1).default("duplicate"),
  searchResultLimit: z.number().int().positive().max(100).default(50),
  candidateLimit: z.number().int().positive().max(50).default(20),
  aiReviewMaxCandidates: z.number().int().positive().max(10).default(3),
  thresholds: z.object({
    exact: z.number().min(0).max(1).default(0.995),
    highConfidence: z.number().min(0).max(1).default(0.93),
    reviewMin: z.number().min(0).max(1).default(0.82)
  }).default(() => ({
    exact: 0.995,
    highConfidence: 0.93,
    reviewMin: 0.82
  }))
});
var keywordRuleSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  labels: z.array(z.string().min(1)).min(1),
  fields: z.array(z.enum(["title", "body", "sections"])).default(["title", "body"]),
  caseSensitive: z.boolean().default(false)
});
var repoBotConfigSchema = z.object({
  runtime: z.object({
    languageMode: z.enum(["auto", "zh", "zh-en"]).default("auto"),
    dryRun: z.boolean().default(false)
  }).default(() => ({
    languageMode: "auto",
    dryRun: false
  })),
  providers: z.object({
    openAiCompatible: z.object({
      enabled: z.boolean().default(false),
      baseUrl: z.string().default(""),
      model: z.string().default(""),
      apiStyle: z.enum(["auto", "responses", "chat_completions"]).default("auto"),
      timeoutMs: z.number().int().positive().default(3e4)
    }).default(() => ({
      enabled: false,
      baseUrl: "",
      model: "",
      apiStyle: "auto",
      timeoutMs: 3e4
    }))
  }).default(() => ({
    openAiCompatible: {
      enabled: false,
      baseUrl: "",
      model: "",
      apiStyle: "auto",
      timeoutMs: 3e4
    }
  })),
  issues: z.object({
    validation: z.object({
      enabled: z.boolean().default(true),
      fallbackTemplateKey: z.string().optional(),
      commentAnchor: z.string().min(1).default("issue-bot:validation"),
      templates: z.array(templateSchema).default([]),
      duplicateDetection: duplicateDetectionSchema.default(() => ({
        enabled: true,
        bypassLabels: ["no-auto-duplicate"],
        duplicateLabel: "duplicate",
        searchResultLimit: 50,
        candidateLimit: 20,
        aiReviewMaxCandidates: 3,
        thresholds: {
          exact: 0.995,
          highConfidence: 0.93,
          reviewMin: 0.82
        }
      }))
    }).default(() => ({
      enabled: true,
      commentAnchor: "issue-bot:validation",
      templates: [],
      duplicateDetection: {
        enabled: true,
        bypassLabels: ["no-auto-duplicate"],
        duplicateLabel: "duplicate",
        searchResultLimit: 50,
        candidateLimit: 20,
        aiReviewMaxCandidates: 3,
        thresholds: {
          exact: 0.995,
          highConfidence: 0.93,
          reviewMin: 0.82
        }
      }
    })),
    labeling: z.object({
      enabled: z.boolean().default(true),
      autoCreateMissing: z.boolean().default(true),
      managed: z.array(z.string().min(1)).default([]),
      definitions: z.record(z.string().min(1), z.object({
        color: z.string().regex(/^[0-9a-fA-F]{6}$/),
        description: z.string().optional()
      })).default({}),
      keywordRules: z.array(keywordRuleSchema).default([])
    }).default(() => ({
      enabled: true,
      autoCreateMissing: true,
      managed: [],
      definitions: {},
      keywordRules: []
    })),
    aiHelp: z.object({
      enabled: z.boolean().default(false),
      triggerLabels: z.array(z.string().min(1)).default([]),
      commentAnchor: z.string().min(1).default("issue-bot:ai")
    }).default(() => ({
      enabled: false,
      triggerLabels: [],
      commentAnchor: "issue-bot:ai"
    }))
  }).default(() => ({
    validation: {
      enabled: true,
      commentAnchor: "issue-bot:validation",
      templates: [],
      duplicateDetection: {
        enabled: true,
        bypassLabels: ["no-auto-duplicate"],
        duplicateLabel: "duplicate",
        searchResultLimit: 50,
        candidateLimit: 20,
        aiReviewMaxCandidates: 3,
        thresholds: {
          exact: 0.995,
          highConfidence: 0.93,
          reviewMin: 0.82
        }
      }
    },
    labeling: {
      enabled: true,
      autoCreateMissing: true,
      managed: [],
      definitions: {},
      keywordRules: []
    },
    aiHelp: {
      enabled: false,
      triggerLabels: [],
      commentAnchor: "issue-bot:ai"
    }
  })),
  pullRequests: z.object({
    review: z.object({
      enabled: z.boolean().default(false)
    }).default(() => ({
      enabled: false
    })),
    labeling: z.object({
      enabled: z.boolean().default(false)
    }).default(() => ({
      enabled: false
    })),
    summary: z.object({
      enabled: z.boolean().default(false)
    }).default(() => ({
      enabled: false
    }))
  }).default(() => ({
    review: {
      enabled: false
    },
    labeling: {
      enabled: false
    },
    summary: {
      enabled: false
    }
  }))
});

// src/config/loadConfig.ts
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function deepMerge(base, override) {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override : base;
  }
  if (isObject(base) && isObject(override)) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
      const current = result[key];
      if (Array.isArray(current)) {
        result[key] = Array.isArray(value) ? value : current;
        continue;
      }
      if (isObject(current)) {
        result[key] = deepMerge(current, value);
        continue;
      }
      result[key] = value;
    }
    return result;
  }
  return override ?? base;
}
async function loadRepoBotConfig(params) {
  const filePath = path.join(params.workspace, params.configPath);
  const rawYaml = await readFile(filePath, "utf8");
  const parsedYaml = yaml.load(rawYaml) ?? {};
  const overrides = params.overridesJson?.trim() ? JSON.parse(params.overridesJson) : {};
  const merged = deepMerge(parsedYaml, overrides);
  const parsed = repoBotConfigSchema.parse(merged);
  parsed.runtime.dryRun = parsed.runtime.dryRun || params.dryRunInput;
  return parsed;
}

// src/github/gateway.ts
import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
function toIssueContext() {
  const issue = context.payload.issue;
  if (!issue || "pull_request" in issue) {
    return void 0;
  }
  return {
    kind: "issue",
    owner: context.repo.owner,
    repo: context.repo.repo,
    number: issue.number,
    title: issue.title ?? "",
    body: issue.body ?? "",
    state: issue.state,
    labels: issue.labels.map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean),
    htmlUrl: issue.html_url ?? "",
    createdAt: issue.created_at ?? "",
    updatedAt: issue.updated_at ?? "",
    action: context.payload.action ?? ""
  };
}
var OctokitGitHubGateway = class {
  constructor(token, dryRun) {
    this.dryRun = dryRun;
    this.octokit = getOctokit(token);
  }
  octokit;
  async getIssueContext() {
    return toIssueContext();
  }
  async listComments(issueNumber) {
    const response = await this.octokit.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      per_page: 100
    });
    return response.data.map((comment) => ({
      id: comment.id,
      body: comment.body ?? "",
      authorLogin: comment.user?.login
    }));
  }
  async createComment(issueNumber, body) {
    if (this.dryRun) {
      core.info(`[dry-run] create comment on issue #${issueNumber}`);
      return;
    }
    await this.octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      body
    });
  }
  async updateComment(commentId, body) {
    if (this.dryRun) {
      core.info(`[dry-run] update comment #${commentId}`);
      return;
    }
    await this.octokit.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: commentId,
      body
    });
  }
  async addLabels(issueNumber, labels) {
    if (labels.length === 0) {
      return;
    }
    if (this.dryRun) {
      core.info(`[dry-run] add labels to issue #${issueNumber}: ${labels.join(", ")}`);
      return;
    }
    await this.octokit.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      labels
    });
  }
  async removeLabel(issueNumber, label) {
    if (this.dryRun) {
      core.info(`[dry-run] remove label from issue #${issueNumber}: ${label}`);
      return;
    }
    try {
      await this.octokit.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        name: label
      });
    } catch (error) {
      core.info(`Skip removing label "${label}": ${String(error)}`);
    }
  }
  async ensureLabels(definitions, labels) {
    if (labels.length === 0) {
      return;
    }
    const existing = await this.octokit.paginate(this.octokit.rest.issues.listLabelsForRepo, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      per_page: 100
    });
    const existingNames = new Set(existing.map((label) => label.name));
    for (const name of labels) {
      if (existingNames.has(name)) {
        continue;
      }
      const definition = definitions[name];
      if (!definition) {
        core.info(`Skip auto-creating undefined label "${name}".`);
        continue;
      }
      if (this.dryRun) {
        core.info(`[dry-run] create label "${name}"`);
        continue;
      }
      await this.octokit.rest.issues.createLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name,
        color: definition.color,
        description: definition.description
      });
    }
  }
  async closeIssue(issueNumber) {
    if (this.dryRun) {
      core.info(`[dry-run] close issue #${issueNumber}`);
      return;
    }
    await this.octokit.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      state: "closed"
    });
  }
  async searchIssues(params) {
    const terms = params.terms.map((term) => `"${term}"`).join(" ");
    const query = [
      `repo:${params.owner}/${params.repo}`,
      "is:issue",
      terms
    ].filter(Boolean).join(" ");
    const searchResponse = await this.octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: Math.min(params.limit, 100),
      sort: "updated",
      order: "desc"
    });
    const directMatches = searchResponse.data.items.filter((item) => !("pull_request" in item) && item.number !== params.currentIssueNumber).map((item) => ({
      number: item.number,
      title: item.title,
      body: item.body ?? "",
      labels: item.labels.map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean),
      state: item.state,
      htmlUrl: item.html_url ?? "",
      createdAt: item.created_at ?? "",
      updatedAt: item.updated_at ?? ""
    }));
    if (directMatches.length >= params.limit) {
      return directMatches.slice(0, params.limit);
    }
    const fallbackIssues = await this.octokit.paginate(this.octokit.rest.issues.listForRepo, {
      owner: params.owner,
      repo: params.repo,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100
    });
    const merged = /* @__PURE__ */ new Map();
    for (const item of directMatches) {
      merged.set(item.number, item);
    }
    for (const issue of fallbackIssues) {
      if (issue.pull_request || issue.number === params.currentIssueNumber) {
        continue;
      }
      merged.set(issue.number, {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        labels: issue.labels.map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean),
        state: issue.state,
        htmlUrl: issue.html_url ?? "",
        createdAt: issue.created_at ?? "",
        updatedAt: issue.updated_at ?? ""
      });
      if (merged.size >= params.limit) {
        break;
      }
    }
    return [...merged.values()];
  }
};

// src/providers/openaiCompatible/client.ts
import * as core2 from "@actions/core";
var ProviderRequestError = class extends Error {
  constructor(message, status, responseText) {
    super(message);
    this.status = status;
    this.responseText = responseText;
  }
};
function createEndpoint(baseUrl, relativePath) {
  const endpointBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(relativePath, endpointBase);
}
function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}
function shouldFallbackToChat(error) {
  if (!(error instanceof ProviderRequestError)) {
    return false;
  }
  if (error.status === 404 || error.status === 405 || error.status === 501) {
    return true;
  }
  const haystack = `${error.message}
${error.responseText ?? ""}`.toLowerCase();
  return [
    "responses",
    "unsupported",
    "not found",
    "unknown parameter",
    "does not support"
  ].some((needle) => haystack.includes(needle));
}
function extractJsonBlock(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    throw new Error("AI response does not contain JSON.");
  }
  return objectMatch[0];
}
async function parseErrorResponse(response) {
  const responseText = await response.text();
  throw new ProviderRequestError(
    `AI provider returned ${response.status}: ${responseText}`,
    response.status,
    responseText
  );
}
async function requestChatCompletion(config, apiKey, messages) {
  const timeout = withTimeout(config.timeoutMs);
  try {
    const response = await fetch(createEndpoint(config.baseUrl, "chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages
      }),
      signal: timeout.signal
    });
    if (!response.ok) {
      await parseErrorResponse(response);
    }
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI provider returned an empty chat completion message.");
    }
    return content;
  } finally {
    timeout.clear();
  }
}
function extractResponsesOutputText(json) {
  if (typeof json.output_text === "string" && json.output_text.trim()) {
    return json.output_text;
  }
  const contentText = json.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text" && typeof item.text === "string").map((item) => item.text?.trim() ?? "").filter(Boolean).join("\n");
  if (contentText) {
    return contentText;
  }
  throw new Error("AI provider returned an empty responses output.");
}
async function requestResponses(config, apiKey, messages, structuredOutput) {
  const timeout = withTimeout(config.timeoutMs);
  try {
    const response = await fetch(createEndpoint(config.baseUrl, "responses"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        input: messages,
        temperature: 0.2,
        text: {
          format: {
            type: "json_schema",
            name: structuredOutput.name,
            strict: true,
            schema: structuredOutput.schema
          }
        }
      }),
      signal: timeout.signal
    });
    if (!response.ok) {
      await parseErrorResponse(response);
    }
    const json = await response.json();
    return extractResponsesOutputText(json);
  } finally {
    timeout.clear();
  }
}
async function requestStructuredJson(config, apiKey, messages, structuredOutput) {
  if (config.apiStyle === "responses") {
    return requestResponses(config, apiKey, messages, structuredOutput);
  }
  if (config.apiStyle === "chat_completions") {
    return requestChatCompletion(config, apiKey, messages);
  }
  try {
    return await requestResponses(config, apiKey, messages, structuredOutput);
  } catch (error) {
    if (!shouldFallbackToChat(error)) {
      throw error;
    }
    core2.info("Responses API is unavailable for the current provider. Falling back to chat/completions.");
    return requestChatCompletion(config, apiKey, messages);
  }
}
var duplicateReviewSchema = {
  name: "duplicate_review",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      duplicate: {
        type: "boolean"
      },
      confidence: {
        type: "number"
      },
      reason: {
        type: "string"
      }
    },
    required: ["duplicate", "confidence", "reason"]
  }
};
var issueHelpSchema = {
  name: "issue_help",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string"
      },
      possibleCauses: {
        type: "array",
        items: {
          type: "string"
        }
      },
      troubleshootingSteps: {
        type: "array",
        items: {
          type: "string"
        }
      },
      missingInformation: {
        type: "array",
        items: {
          type: "string"
        }
      }
    },
    required: ["summary", "possibleCauses", "troubleshootingSteps", "missingInformation"]
  }
};
var OpenAiCompatibleProvider = class {
  constructor(config, apiKey) {
    this.config = config;
    this.apiKey = apiKey;
  }
  isAvailable() {
    return this.config.enabled && Boolean(this.config.baseUrl) && Boolean(this.config.model) && Boolean(this.apiKey);
  }
  async reviewDuplicate(issue, candidate) {
    const content = await requestStructuredJson(this.config, this.apiKey, [
      {
        role: "system",
        content: "\u4F60\u662F GitHub \u4ED3\u5E93\u673A\u5668\u4EBA\u3002\u8BF7\u5224\u65AD\u4E24\u4E2A issue \u662F\u5426\u63CF\u8FF0\u540C\u4E00\u4E2A\u95EE\u9898\uFF0C\u53EA\u8FD4\u56DE JSON\u3002confidence \u53D6\u503C\u8303\u56F4\u4E3A 0 \u5230 1\u3002"
      },
      {
        role: "user",
        content: JSON.stringify({
          currentIssue: {
            title: issue.title,
            body: issue.body,
            labels: issue.labels
          },
          candidateIssue: candidate
        })
      }
    ], duplicateReviewSchema);
    const parsed = JSON.parse(extractJsonBlock(content));
    return {
      duplicate: Boolean(parsed.duplicate),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: parsed.reason ?? ""
    };
  }
  async generateHelp(issue, sections) {
    const content = await requestStructuredJson(this.config, this.apiKey, [
      {
        role: "system",
        content: "\u4F60\u662F GitHub Issue \u52A9\u624B\u673A\u5668\u4EBA\u3002\u8BF7\u6839\u636E issue \u5185\u5BB9\u7ED9\u51FA\u7B80\u6D01\u4E14\u53EF\u6267\u884C\u7684\u6392\u67E5\u5EFA\u8BAE\uFF0C\u53EA\u8FD4\u56DE JSON\u3002"
      },
      {
        role: "user",
        content: JSON.stringify({
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
          sections
        })
      }
    ], issueHelpSchema);
    const parsed = JSON.parse(extractJsonBlock(content));
    return {
      summary: parsed.summary ?? "\u672A\u80FD\u751F\u6210\u6458\u8981\u3002",
      possibleCauses: Array.isArray(parsed.possibleCauses) ? parsed.possibleCauses : [],
      troubleshootingSteps: Array.isArray(parsed.troubleshootingSteps) ? parsed.troubleshootingSteps : [],
      missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation : []
    };
  }
};
function tryCreateProvider(config) {
  const apiKey = process.env.REPO_BOT_AI_API_KEY ?? "";
  const provider = new OpenAiCompatibleProvider(config, apiKey);
  if (!provider.isAvailable()) {
    core2.info("OpenAI-compatible provider is not fully configured. AI features will be skipped or downgraded.");
    return void 0;
  }
  return provider;
}

// src/subjects/issue/run.ts
import * as core5 from "@actions/core";

// src/github/comments.ts
function createAnchor(anchor) {
  return `<!-- ${anchor} -->`;
}
async function upsertAnchoredComment(params) {
  const anchor = createAnchor(params.anchor);
  const fullBody = `${anchor}
${params.body}`;
  const comments = await params.gateway.listComments(params.issueNumber);
  const existing = comments.find((comment) => comment.body.includes(anchor));
  if (existing) {
    await params.gateway.updateComment(existing.id, fullBody);
    return;
  }
  await params.gateway.createComment(params.issueNumber, fullBody);
}

// src/i18n/language.ts
function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}
function detectCommentMode(text, runtime) {
  if (runtime.languageMode === "zh" || runtime.languageMode === "zh-en") {
    return runtime.languageMode;
  }
  const chineseCharacters = countMatches(text, /[\u3400-\u9fff]/g);
  const englishWords = countMatches(text, /\b[a-zA-Z]{2,}\b/g);
  if (englishWords >= 12 && englishWords > chineseCharacters * 2) {
    return "zh-en";
  }
  return "zh";
}

// src/subjects/issue/aiHelp.ts
import * as core3 from "@actions/core";

// src/i18n/comments.ts
function bilingual(mode, zh, en) {
  if (mode === "zh") {
    return zh;
  }
  return `${zh}

---

${en}`;
}
function renderValidationComment(params) {
  if (params.valid) {
    return bilingual(
      params.mode,
      `## \u6A21\u677F\u68C0\u67E5\u7ED3\u679C

\u5DF2\u901A\u8FC7\u6A21\u677F\u68C0\u67E5\u3002\u5F53\u524D\u8BC6\u522B\u6A21\u677F\uFF1A\`${params.templateKey ?? "unknown"}\`\u3002`,
      `## Template Check Result

The issue passed template validation. Detected template: \`${params.templateKey ?? "unknown"}\`.`
    );
  }
  const zhMissing = params.missingSections.map((item) => `- ${item}`).join("\n") || "- \u65E0";
  const enMissing = params.missingSections.map((item) => `- ${item}`).join("\n") || "- None";
  return bilingual(
    params.mode,
    `## \u6A21\u677F\u68C0\u67E5\u7ED3\u679C

Issue \u672A\u901A\u8FC7\u6A21\u677F\u68C0\u67E5\uFF0C\u8BF7\u8865\u5145\u4EE5\u4E0B\u5FC5\u586B\u5185\u5BB9\uFF1A
${zhMissing}`,
    `## Template Check Result

This issue did not pass template validation. Please complete the following required sections:
${enMissing}`
  );
}
function renderDuplicateComment(params) {
  const duplicateLine = `Duplicate of #${params.duplicateOf.number}`;
  const zh = `${duplicateLine}

## \u91CD\u590D Issue \u5904\u7406

\u68C0\u6D4B\u5230\u8BE5 Issue \u4E0E #${params.duplicateOf.number} \u9AD8\u5EA6\u76F8\u4F3C\uFF0C\u5DF2\u6309\u91CD\u590D\u95EE\u9898\u5173\u95ED\u3002

- \u539F Issue\uFF1A${params.duplicateOf.htmlUrl}
- \u7F6E\u4FE1\u5EA6\uFF1A${params.confidence.toFixed(2)}`;
  const en = `${duplicateLine}

## Duplicate Issue Handling

This issue is highly similar to #${params.duplicateOf.number} and has been closed as a duplicate.

- Canonical issue: ${params.duplicateOf.htmlUrl}
- Confidence: ${params.confidence.toFixed(2)}`;
  return params.mode === "zh" ? zh : `${zh}

---

${en}`;
}
function renderAiHelpComment(params) {
  const zh = [
    "## AI \u5206\u6790\u5EFA\u8BAE",
    "",
    `### \u95EE\u9898\u6982\u8FF0
${params.help.summary}`,
    "",
    "### \u53EF\u80FD\u539F\u56E0",
    ...params.help.possibleCauses.map((item) => `- ${item}`),
    "",
    "### \u5EFA\u8BAE\u6392\u67E5\u6B65\u9AA4",
    ...params.help.troubleshootingSteps.map((item) => `- ${item}`),
    "",
    "### \u4ECD\u9700\u8865\u5145\u7684\u4FE1\u606F",
    ...params.help.missingInformation.length > 0 ? params.help.missingInformation.map((item) => `- ${item}`) : ["- \u6682\u65E0"]
  ].join("\n");
  if (params.mode === "zh") {
    return zh;
  }
  const en = [
    "## AI Guidance",
    "",
    `### Summary
${params.help.summary}`,
    "",
    "### Possible Causes",
    ...params.help.possibleCauses.map((item) => `- ${item}`),
    "",
    "### Suggested Troubleshooting Steps",
    ...params.help.troubleshootingSteps.map((item) => `- ${item}`),
    "",
    "### Additional Information Needed",
    ...params.help.missingInformation.length > 0 ? params.help.missingInformation.map((item) => `- ${item}`) : ["- None"]
  ].join("\n");
  return `${zh}

---

${en}`;
}

// src/subjects/issue/aiHelp.ts
async function generateIssueAiHelp(params) {
  if (!params.config.enabled) {
    return void 0;
  }
  if (!params.provider) {
    core3.info("Skip AI help because provider is unavailable.");
    return void 0;
  }
  const hasTriggerLabel = params.config.triggerLabels.length === 0 || params.config.triggerLabels.some((label) => params.issue.labels.includes(label));
  if (!hasTriggerLabel) {
    core3.info("Skip AI help because trigger labels do not match.");
    return void 0;
  }
  const help = await params.provider.generateHelp(params.issue, params.parsed.sections);
  return renderAiHelpComment({
    mode: params.commentMode,
    help
  });
}

// src/subjects/issue/duplicateDetection.ts
import * as core4 from "@actions/core";

// src/subjects/issue/parser.ts
function normalizeHeading(value) {
  return value.toLowerCase().replace(/[*_`:#]/g, "").trim();
}
function extractTemplateMarker(body) {
  const match = body.match(/<!--\s*issue-template:\s*([a-zA-Z0-9_-]+)\s*-->/i);
  return match?.[1];
}
function parseIssueBody(body) {
  const sections = {};
  const headings = [];
  const lines = body.split(/\r?\n/);
  let currentHeading = "__root__";
  let buffer = [];
  const flush = () => {
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
function matchTemplate(parsed, templates, fallbackTemplateKey) {
  if (parsed.marker) {
    const byMarker = templates.find((template) => template.detect.markers.includes(parsed.marker));
    if (byMarker) {
      return byMarker;
    }
  }
  if (fallbackTemplateKey) {
    return templates.find((template) => template.key === fallbackTemplateKey);
  }
  return templates[0];
}
function getSectionContent(parsed, rule) {
  const aliases = rule.aliases.map(normalizeHeading);
  for (const alias of aliases) {
    if (alias in parsed.sections) {
      return parsed.sections[alias] ?? "";
    }
  }
  return "";
}
function normalizeText(value) {
  return value.toLowerCase().replace(/```[\s\S]*?```/g, " ").replace(/`[^`]+`/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/[^\p{Letter}\p{Number}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function tokenize(value) {
  return normalizeText(value).split(" ").filter((token) => token.length >= 2);
}

// src/subjects/issue/duplicateDetection.ts
function jaccardSimilarity(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = (/* @__PURE__ */ new Set([...leftSet, ...rightSet])).size;
  return union === 0 ? 0 : intersection / union;
}
function cosineBagSimilarity(left, right) {
  const counts = /* @__PURE__ */ new Map();
  for (const token of left) {
    const entry = counts.get(token) ?? [0, 0];
    entry[0] += 1;
    counts.set(token, entry);
  }
  for (const token of right) {
    const entry = counts.get(token) ?? [0, 0];
    entry[1] += 1;
    counts.set(token, entry);
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [leftCount, rightCount] of counts.values()) {
    dot += leftCount * rightCount;
    leftNorm += leftCount * leftCount;
    rightNorm += rightCount * rightCount;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
function buildIssueSignature(title, parsed) {
  const sectionSummary = Object.entries(parsed.sections).filter(([key]) => key !== "__root__").sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}:${normalizeText(value).slice(0, 120)}`).join("|");
  return normalizeText(`${title}|${sectionSummary}`);
}
function rankCandidate(issue, parsed, candidate) {
  const currentSignature = buildIssueSignature(issue.title, parsed);
  const candidateSignature = buildIssueSignature(candidate.title, parseIssueBody(candidate.body));
  if (currentSignature && currentSignature === candidateSignature) {
    return 1;
  }
  const titleJaccard = jaccardSimilarity(tokenize(issue.title), tokenize(candidate.title));
  const bodyCosine = cosineBagSimilarity(tokenize(issue.body), tokenize(candidate.body));
  const signatureJaccard = jaccardSimilarity(tokenize(currentSignature), tokenize(candidateSignature));
  return titleJaccard * 0.4 + bodyCosine * 0.35 + signatureJaccard * 0.25;
}
function chooseCanonicalIssue(candidates) {
  return [...candidates].sort((left, right) => {
    if (left.state !== right.state) {
      return left.state === "open" ? -1 : 1;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt);
    }
    return left.number - right.number;
  })[0];
}
async function detectDuplicate(params) {
  if (!params.config.enabled) {
    return { executed: false, skippedReason: "duplicate detection disabled" };
  }
  if (params.issue.labels.some((label) => params.config.bypassLabels.includes(label))) {
    return { executed: true, skippedReason: "bypass label matched" };
  }
  const terms = [...new Set(tokenize(params.issue.title).slice(0, 6))];
  const searchResults = await params.searchIssues(terms, params.config.searchResultLimit);
  const ranked = searchResults.map((candidate) => ({
    candidate,
    score: rankCandidate(params.issue, params.parsed, candidate)
  })).sort((left, right) => right.score - left.score).slice(0, params.config.candidateLimit);
  const exactMatch = ranked.find((entry) => entry.score >= params.config.thresholds.exact);
  if (exactMatch) {
    const canonical = chooseCanonicalIssue([exactMatch.candidate]);
    if (!canonical) {
      return { executed: true, skippedReason: "exact match missing canonical candidate" };
    }
    await params.addDuplicateLabel([params.config.duplicateLabel]);
    await params.addDuplicateComment(renderDuplicateComment({
      mode: params.commentMode,
      duplicateOf: canonical,
      confidence: exactMatch.score
    }));
    await params.closeIssue();
    return {
      executed: true,
      duplicateOf: canonical,
      confidence: exactMatch.score
    };
  }
  const highConfidence = ranked.filter((entry) => entry.score >= params.config.thresholds.highConfidence);
  if (highConfidence.length > 0) {
    const canonical = chooseCanonicalIssue(highConfidence.map((entry) => entry.candidate));
    if (!canonical) {
      return { executed: true, skippedReason: "high confidence match missing canonical candidate" };
    }
    const score = highConfidence.find((entry) => entry.candidate.number === canonical.number)?.score ?? highConfidence[0].score;
    await params.addDuplicateLabel([params.config.duplicateLabel]);
    await params.addDuplicateComment(renderDuplicateComment({
      mode: params.commentMode,
      duplicateOf: canonical,
      confidence: score
    }));
    await params.closeIssue();
    return {
      executed: true,
      duplicateOf: canonical,
      confidence: score
    };
  }
  if (!params.provider) {
    return { executed: true, skippedReason: "provider unavailable for duplicate AI review" };
  }
  const reviewCandidates = ranked.filter((entry) => entry.score >= params.config.thresholds.reviewMin).slice(0, params.config.aiReviewMaxCandidates);
  let bestReview;
  for (const entry of reviewCandidates) {
    try {
      const review = await params.provider.reviewDuplicate(params.issue, entry.candidate);
      if (review.duplicate && (!bestReview || review.confidence > bestReview.review.confidence)) {
        bestReview = {
          candidate: entry.candidate,
          review
        };
      }
    } catch (error) {
      core4.info(`Duplicate AI review failed for #${entry.candidate.number}: ${String(error)}`);
    }
  }
  if (!bestReview) {
    return { executed: true, skippedReason: "no duplicate candidate confirmed by AI" };
  }
  await params.addDuplicateLabel([params.config.duplicateLabel]);
  await params.addDuplicateComment(renderDuplicateComment({
    mode: params.commentMode,
    duplicateOf: bestReview.candidate,
    confidence: bestReview.review.confidence
  }));
  await params.closeIssue();
  return {
    executed: true,
    duplicateOf: bestReview.candidate,
    confidence: bestReview.review.confidence,
    aiReviewed: true
  };
}

// src/subjects/issue/labeling.ts
function includesKeyword(text, keyword, caseSensitive) {
  if (caseSensitive) {
    return text.includes(keyword);
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
}
function computeManagedLabels(params) {
  const currentLabels = new Set(params.issue.labels);
  const desired = new Set(params.preservedLabels ?? []);
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

// src/core/constants.ts
var DEFAULT_PLACEHOLDER_HINTS = [
  "\u8BF7\u586B\u5199",
  "please fill",
  "todo",
  "tbd",
  "n/a",
  "none",
  "\u5F85\u8865\u5145",
  "\u5F85\u586B\u5199",
  "not provided"
];

// src/subjects/issue/validation.ts
function isPlaceholder(content, hints) {
  const normalized = normalizeText(content);
  if (!normalized) {
    return true;
  }
  return hints.some((hint) => {
    const needle = normalizeText(hint);
    if (!needle) {
      return false;
    }
    return normalized === needle || normalized.startsWith(`${needle} `) || normalized.endsWith(` ${needle}`) || normalized.includes(` ${needle} `);
  });
}
function validateIssue(params) {
  if (!params.config.enabled) {
    return {
      executed: false,
      valid: true,
      parsed: parseIssueBody(params.body),
      missingSections: [],
      desiredLabels: [],
      invalidLabels: []
    };
  }
  const parsed = parseIssueBody(params.body);
  const template = matchTemplate(parsed, params.config.templates, params.config.fallbackTemplateKey);
  if (!template) {
    return {
      executed: true,
      valid: false,
      parsed,
      missingSections: [],
      desiredLabels: [],
      invalidLabels: [],
      commentBody: renderValidationComment({
        mode: params.commentMode,
        valid: false,
        missingSections: ["\u672A\u627E\u5230\u53EF\u7528\u6A21\u677F / No matching template found"]
      })
    };
  }
  const missingSections = template.requiredSections.filter((rule) => {
    const content = getSectionContent(parsed, rule);
    const hints = [...DEFAULT_PLACEHOLDER_HINTS, ...rule.placeholderHints ?? []];
    return isPlaceholder(content, hints);
  }).map((rule) => ({
    id: rule.id,
    aliases: rule.aliases
  }));
  const valid = missingSections.length === 0;
  return {
    executed: true,
    valid,
    template,
    parsed,
    missingSections,
    desiredLabels: valid ? template.labels.whenValid : [],
    invalidLabels: valid ? [] : template.labels.whenInvalid,
    commentBody: renderValidationComment({
      mode: params.commentMode,
      valid,
      templateKey: template.key,
      missingSections: missingSections.map((item) => item.aliases[0] ?? item.id)
    })
  };
}

// src/subjects/issue/run.ts
function shouldRunValidation(action) {
  return ["opened", "edited", "reopened"].includes(action);
}
function shouldRunLabeling(action) {
  return ["opened", "edited", "reopened", "labeled"].includes(action);
}
function shouldRunAi(action) {
  return ["opened", "edited", "reopened", "labeled"].includes(action);
}
async function runIssueWorkflow(params) {
  const effectiveLabels = new Set(params.issue.labels);
  const commentMode = detectCommentMode(`${params.issue.title}
${params.issue.body}`, params.config.runtime);
  const validation = validateIssue({
    body: params.issue.body,
    config: params.config.issues.validation,
    commentMode
  });
  if (shouldRunValidation(params.issue.action) && validation.commentBody) {
    await upsertAnchoredComment({
      gateway: params.gateway,
      issueNumber: params.issue.number,
      anchor: params.config.issues.validation.commentAnchor,
      body: validation.commentBody
    });
  }
  if (shouldRunValidation(params.issue.action) && validation.executed && !validation.valid) {
    core5.info("Issue failed template validation. Skip duplicate detection and AI help.");
  }
  let duplicated = false;
  if (shouldRunValidation(params.issue.action) && validation.valid) {
    const duplicateDecision = await detectDuplicate({
      issue: params.issue,
      parsed: validation.parsed,
      config: params.config.issues.validation.duplicateDetection,
      commentMode,
      provider: params.provider,
      searchIssues: async (terms, limit) => params.gateway.searchIssues({
        owner: params.issue.owner,
        repo: params.issue.repo,
        currentIssueNumber: params.issue.number,
        terms,
        limit
      }),
      addDuplicateComment: async (body) => {
        await params.gateway.createComment(params.issue.number, body);
      },
      addDuplicateLabel: async (labels) => {
        if (params.config.issues.labeling.autoCreateMissing) {
          await params.gateway.ensureLabels(params.config.issues.labeling.definitions, labels);
        }
        await params.gateway.addLabels(params.issue.number, labels);
        for (const label of labels) {
          effectiveLabels.add(label);
        }
      },
      closeIssue: async () => {
        await params.gateway.closeIssue(params.issue.number);
      }
    });
    duplicated = Boolean(duplicateDecision.duplicateOf);
  }
  if (shouldRunLabeling(params.issue.action) && params.config.issues.labeling.enabled && !duplicated) {
    const preservedLabels = [...effectiveLabels].filter((label) => params.config.issues.aiHelp.triggerLabels.includes(label));
    const managedLabels = computeManagedLabels({
      issue: params.issue,
      config: params.config.issues.labeling,
      validation,
      preservedLabels
    });
    if (params.config.issues.labeling.autoCreateMissing) {
      await params.gateway.ensureLabels(params.config.issues.labeling.definitions, managedLabels.labelsToAdd);
    }
    if (managedLabels.labelsToAdd.length > 0) {
      await params.gateway.addLabels(params.issue.number, managedLabels.labelsToAdd);
      for (const label of managedLabels.labelsToAdd) {
        effectiveLabels.add(label);
      }
    }
    for (const label of managedLabels.labelsToRemove) {
      await params.gateway.removeLabel(params.issue.number, label);
      effectiveLabels.delete(label);
    }
  }
  if (duplicated || !shouldRunAi(params.issue.action) || !validation.valid) {
    return;
  }
  const aiBody = await generateIssueAiHelp({
    issue: {
      ...params.issue,
      labels: [...effectiveLabels]
    },
    parsed: validation.parsed,
    config: params.config.issues.aiHelp,
    commentMode,
    provider: params.provider
  });
  if (!aiBody) {
    return;
  }
  await upsertAnchoredComment({
    gateway: params.gateway,
    issueNumber: params.issue.number,
    anchor: params.config.issues.aiHelp.commentAnchor,
    body: aiBody
  });
}

// src/index.ts
async function run() {
  try {
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const configPath = core6.getInput("config-path") || ".github/repo-bot.yml";
    const overridesJson = core6.getInput("config-overrides-json");
    const dryRun = core6.getBooleanInput("dry-run", { required: false });
    const config = await loadRepoBotConfig({
      workspace,
      configPath,
      overridesJson,
      dryRunInput: dryRun
    });
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("Missing GITHUB_TOKEN.");
    }
    const gateway = new OctokitGitHubGateway(token, config.runtime.dryRun);
    const provider = tryCreateProvider(config.providers.openAiCompatible);
    const issue = await gateway.getIssueContext();
    if (!issue) {
      core6.info("Current event is not a plain issue event. Nothing to do.");
      return;
    }
    await runIssueWorkflow({
      issue,
      config,
      gateway,
      provider
    });
    core6.info(`Repo Bot completed for issue #${issue.number}.`);
  } catch (error) {
    core6.setFailed(error instanceof Error ? error.message : String(error));
  }
}
void run();
