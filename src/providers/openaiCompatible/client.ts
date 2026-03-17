import * as core from "@actions/core";

import type {
  AiHelpResult,
  CommentMode,
  DuplicateCandidate,
  DuplicateReviewResult,
  FixSuggestionResult,
  IssueImageReference,
  IssueContext,
  LabelClassificationResult,
  ParsedIssue,
  ProviderConfig,
  RepositoryCodeContext,
  RepositoryAiContext
} from "../../core/types.js";

type ProviderMessage = {
  role: "system" | "user";
  text: string;
  images?: IssueImageReference[];
};

type StructuredOutputSchema = {
  name: string;
  schema: Record<string, unknown>;
};

type ResponsesInputContent =
  | string
  | Array<
    | {
      type: "input_text";
      text: string;
    }
    | {
      type: "input_image";
      image_url: string;
    }
  >;

type ChatCompletionContent =
  | string
  | Array<
    | {
      type: "text";
      text: string;
    }
    | {
      type: "image_url";
      image_url: {
        url: string;
      };
    }
  >;

class ProviderRequestError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string
  ) {
    super(message);
  }
}

function createEndpoint(baseUrl: string, relativePath: string): URL {
  const endpointBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(relativePath, endpointBase);
}

function createEndpointCandidates(baseUrl: string, relativePath: string): URL[] {
  const primary = createEndpoint(baseUrl, relativePath);
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const normalizedPath = base.pathname.replace(/\/+$/, "");

  if (normalizedPath.length > 0) {
    return [primary];
  }

  const versioned = new URL(`v1/${relativePath}`, base);
  return primary.href === versioned.href ? [primary] : [primary, versioned];
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}

function shouldFallbackToChat(error: unknown): boolean {
  if (!(error instanceof ProviderRequestError)) {
    return false;
  }

  if (error.status === 404 || error.status === 405 || error.status === 501) {
    return true;
  }

  const haystack = `${error.message}\n${error.responseText ?? ""}`.toLowerCase();
  return [
    "responses",
    "unsupported",
    "not found",
    "unknown parameter",
    "does not support"
  ].some((needle) => haystack.includes(needle));
}

function shouldRetryWithoutImages(error: unknown): boolean {
  if (!(error instanceof ProviderRequestError)) {
    return false;
  }

  if (![400, 415, 422, 501].includes(error.status ?? 0)) {
    return false;
  }

  const haystack = `${error.message}\n${error.responseText ?? ""}`.toLowerCase();
  return [
    "image",
    "vision",
    "multimodal",
    "input_image",
    "image_url",
    "unsupported content",
    "unsupported input"
  ].some((needle) => haystack.includes(needle));
}

function hasImages(messages: ProviderMessage[]): boolean {
  return messages.some((message) => (message.images?.length ?? 0) > 0);
}

function stripImages(messages: ProviderMessage[]): ProviderMessage[] {
  return messages.map((message) => ({
    role: message.role,
    text: message.text
  }));
}

function toResponsesInputContent(message: ProviderMessage): ResponsesInputContent {
  const images = message.images ?? [];
  if (images.length === 0) {
    return message.text;
  }

  return [
    {
      type: "input_text",
      text: message.text
    },
    ...images.map((image) => ({
      type: "input_image" as const,
      image_url: image.url
    }))
  ];
}

function toChatCompletionContent(message: ProviderMessage): ChatCompletionContent {
  const images = message.images ?? [];
  if (images.length === 0) {
    return message.text;
  }

  return [
    {
      type: "text",
      text: message.text
    },
    ...images.map((image) => ({
      type: "image_url" as const,
      image_url: {
        url: image.url
      }
    }))
  ];
}

function extractJsonBlock(text: string): string {
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

async function fetchWithBaseUrlFallback(
  baseUrl: string,
  relativePath: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const timeout = withTimeout(timeoutMs);

  try {
    const endpoints = createEndpointCandidates(baseUrl, relativePath);

    for (const [index, endpoint] of endpoints.entries()) {
      const response = await fetch(endpoint, {
        ...init,
        signal: timeout.signal
      });

      if (response.ok) {
        return response;
      }

      const responseText = await response.text();
      const error = new ProviderRequestError(
        `AI provider returned ${response.status}: ${responseText}`,
        response.status,
        responseText
      );

      const canRetryWithVersionedPath =
        response.status === 404 &&
        index === 0 &&
        endpoints.length > 1;

      if (!canRetryWithVersionedPath) {
        throw error;
      }

      core.info(`AI provider returned 404 for ${endpoint.toString()}. Retrying with /v1-prefixed endpoint.`);
    }

    throw new Error(`Failed to reach AI provider endpoint for ${relativePath}.`);
  } finally {
    timeout.clear();
  }
}

async function requestChatCompletion(
  config: ProviderConfig,
  apiKey: string,
  messages: ProviderMessage[]
): Promise<string> {
  const response = await fetchWithBaseUrlFallback(
    config.baseUrl,
    "chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: messages.map((message) => ({
          role: message.role,
          content: toChatCompletionContent(message)
        }))
      })
    },
    config.timeoutMs
  );

  const json = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI provider returned an empty chat completion message.");
  }

  return content;
}

function extractResponsesOutputText(json: {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}): string {
  if (typeof json.output_text === "string" && json.output_text.trim()) {
    return json.output_text;
  }

  const contentText = json.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n");

  if (contentText) {
    return contentText;
  }

  throw new Error("AI provider returned an empty responses output.");
}

async function requestResponses(
  config: ProviderConfig,
  apiKey: string,
  messages: ProviderMessage[],
  structuredOutput: StructuredOutputSchema
): Promise<string> {
  const response = await fetchWithBaseUrlFallback(
    config.baseUrl,
    "responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        input: messages.map((message) => ({
          role: message.role,
          content: toResponsesInputContent(message)
        })),
        temperature: 0.2,
        text: {
          format: {
            type: "json_schema",
            name: structuredOutput.name,
            strict: true,
            schema: structuredOutput.schema
          }
        }
      })
    },
    config.timeoutMs
  );

  const json = await response.json() as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  return extractResponsesOutputText(json);
}

async function requestStructuredJson(
  config: ProviderConfig,
  apiKey: string,
  messages: ProviderMessage[],
  structuredOutput: StructuredOutputSchema
): Promise<string> {
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
    core.info("Responses API is unavailable for the current provider. Falling back to chat/completions.");
    return requestChatCompletion(config, apiKey, messages);
  }
}

const duplicateReviewSchema: StructuredOutputSchema = {
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

const issueHelpSchema: StructuredOutputSchema = {
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

const fixSuggestionSchema: StructuredOutputSchema = {
  name: "fix_suggestion",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string"
      },
      candidateFiles: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: {
              type: "string"
            },
            reason: {
              type: "string"
            }
          },
          required: ["path", "reason"]
        }
      },
      changeSuggestions: {
        type: "array",
        items: {
          type: "string"
        }
      },
      patchDraft: {
        type: "string"
      },
      verificationSteps: {
        type: "array",
        items: {
          type: "string"
        }
      },
      risks: {
        type: "array",
        items: {
          type: "string"
        }
      }
    },
    required: ["summary", "candidateFiles", "changeSuggestions", "patchDraft", "verificationSteps", "risks"]
  }
};

const labelClassificationSchema: StructuredOutputSchema = {
  name: "label_classification",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      labels: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: {
              type: "string"
            },
            confidence: {
              type: "number"
            },
            reason: {
              type: "string"
            }
          },
          required: ["name", "confidence", "reason"]
        }
      }
    },
    required: ["labels"]
  }
};

function createIssueHelpInstruction(templateKey: string): string {
  switch (templateKey) {
    case "bug":
      return "The issue type is bug. Focus on likely root causes, concrete troubleshooting steps, and the truly missing debugging details.";
    case "question":
      return "The issue type is question. Answer the user's question directly first. Use possibleCauses as key points or supporting evidence, troubleshootingSteps as suggested next steps or references, and keep missingInformation empty unless more technical context is genuinely required.";
    case "feature":
    case "suggestion":
      return "The issue type is feature or suggestion. Treat it as a proposal rather than a fault report. Focus on feasibility, implementation directions, tradeoffs, and recommended next steps. Use possibleCauses as feasible approaches or considerations.";
    default:
      return "The issue type is general feedback. Avoid pretending that every issue is a defect. Adapt the response to the issue intent while still filling the required JSON fields.";
  }
}

function createFixInstruction(templateKey: string): string {
  switch (templateKey) {
    case "bug":
      return "The issue type is bug. Focus on a practical code-level fix, the most likely target files, and a realistic patch draft.";
    case "question":
      return "The issue type is question. If a code change seems useful, propose it carefully; otherwise keep the patch draft minimal and explain the uncertainty.";
    case "feature":
    case "suggestion":
      return "The issue type is feature or suggestion. Treat the output as an implementation proposal and patch draft, not as a confirmed bug fix.";
    default:
      return "Treat the output as a cautious repository-specific implementation suggestion with a patch draft.";
  }
}

function createOutputLanguageInstruction(mode: CommentMode): string {
  if (mode === "zh") {
    return "All human-readable JSON fields must be written in Simplified Chinese. Keep file paths, code identifiers, and diff syntax unchanged where necessary.";
  }

  return "All human-readable JSON fields must be bilingual with Simplified Chinese first and English second. Keep file paths, code identifiers, and diff syntax unchanged where necessary.";
}

const MAX_ISSUE_IMAGES = 3;

function summarizeIssueImages(images: IssueImageReference[]): Array<{
  url: string;
  altText: string;
}> {
  return images.slice(0, MAX_ISSUE_IMAGES).map((image) => ({
    url: image.url,
    altText: image.altText
  }));
}

export class OpenAiCompatibleProvider {
  public constructor(
    private readonly config: ProviderConfig,
    private readonly apiKey: string
  ) {}

  public isAvailable(): boolean {
    return this.config.enabled && Boolean(this.config.baseUrl) && Boolean(this.config.model) && Boolean(this.apiKey);
  }

  public async reviewDuplicate(issue: IssueContext, candidate: DuplicateCandidate): Promise<DuplicateReviewResult> {
    const content = await requestStructuredJson(this.config, this.apiKey, [
      {
        role: "system",
        text: "You are a GitHub repository bot. Decide whether two issues describe the same problem. Return JSON only. `duplicate` must be boolean and `confidence` must be between 0 and 1."
      },
      {
        role: "user",
        text: JSON.stringify({
          currentIssue: {
            title: issue.title,
            body: issue.body,
            labels: issue.labels
          },
          candidateIssue: candidate
        })
      }
    ], duplicateReviewSchema);

    const parsed = JSON.parse(extractJsonBlock(content)) as DuplicateReviewResult;
    return {
      duplicate: Boolean(parsed.duplicate),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: parsed.reason ?? ""
    };
  }

  public async generateHelp(
    issue: IssueContext,
    parsed: ParsedIssue,
    repositoryContext: RepositoryAiContext
  ): Promise<AiHelpResult> {
    const templateKey = repositoryContext.templateKey ?? "unknown";
    const images = summarizeIssueImages(parsed.images);
    if (images.length > 0) {
      core.info(`Including ${images.length} issue image(s) in AI help request.`);
    }

    const messages: ProviderMessage[] = [
      {
        role: "system",
        text: [
          "You are a GitHub issue assistant for the current repository.",
          "Treat the provided repository context as the ground truth for the current project.",
          "Assume the issue is about this repository unless the issue clearly points to an external dependency or upstream project.",
          "Do not ask the user to provide the current repository link, repository name, or project identity again.",
          "If issue images are attached, use them as supporting evidence for the current repository issue.",
          "If more information is needed, ask only for truly missing technical details such as module, version, logs, environment, or reproduction steps.",
          createIssueHelpInstruction(templateKey),
          "Return JSON only."
        ].join(" ")
      },
      {
        role: "user",
        text: JSON.stringify({
          repositoryContext,
          issueType: templateKey,
          issue: {
            title: issue.title,
            body: issue.body,
            labels: issue.labels,
            sections: parsed.sections,
            images,
            totalImageCount: parsed.images.length
          }
        }),
        images
      }
    ];

    let content: string;
    try {
      content = await requestStructuredJson(this.config, this.apiKey, messages, issueHelpSchema);
    } catch (error) {
      if (!hasImages(messages) || !shouldRetryWithoutImages(error)) {
        throw error;
      }

      core.warning(`AI provider rejected image inputs. Retrying issue help without images: ${String(error)}`);
      content = await requestStructuredJson(this.config, this.apiKey, stripImages(messages), issueHelpSchema);
    }

    const parsedResult = JSON.parse(extractJsonBlock(content)) as AiHelpResult;
    return {
      summary: parsedResult.summary ?? "Unable to generate a summary.",
      possibleCauses: Array.isArray(parsedResult.possibleCauses) ? parsedResult.possibleCauses : [],
      troubleshootingSteps: Array.isArray(parsedResult.troubleshootingSteps) ? parsedResult.troubleshootingSteps : [],
      missingInformation: Array.isArray(parsedResult.missingInformation) ? parsedResult.missingInformation : []
    };
  }

  public async generateFixSuggestion(
    issue: IssueContext,
    parsed: ParsedIssue,
    repositoryContext: RepositoryAiContext,
    codeContext: RepositoryCodeContext,
    commentMode: CommentMode
  ): Promise<FixSuggestionResult> {
    const templateKey = repositoryContext.templateKey ?? "unknown";
    const content = await requestStructuredJson(this.config, this.apiKey, [
      {
        role: "system",
        text: [
          "You are a GitHub issue assistant generating repository-specific fix suggestions.",
          "Use the provided repository context and code excerpts as the primary source of truth.",
          "Do not claim that a patch is confirmed unless the code excerpts clearly support it.",
          "If the evidence is incomplete, state the uncertainty in the summary, risks, and patch draft.",
          "Keep the candidate files aligned with the provided code context whenever possible.",
          "Write patchDraft as a compact unified diff or pseudo diff that an engineer could refine.",
          createOutputLanguageInstruction(commentMode),
          createFixInstruction(templateKey),
          "Return JSON only."
        ].join(" ")
      },
      {
        role: "user",
        text: JSON.stringify({
          repositoryContext,
          codeContext,
          issueType: templateKey,
          issue: {
            title: issue.title,
            body: issue.body,
            labels: issue.labels,
            sections: parsed.sections
          }
        })
      }
    ], fixSuggestionSchema);

    const parsedResult = JSON.parse(extractJsonBlock(content)) as FixSuggestionResult;
    return {
      summary: parsedResult.summary ?? "Unable to generate a fix suggestion.",
      candidateFiles: Array.isArray(parsedResult.candidateFiles) ? parsedResult.candidateFiles : [],
      changeSuggestions: Array.isArray(parsedResult.changeSuggestions) ? parsedResult.changeSuggestions : [],
      patchDraft: parsedResult.patchDraft ?? "",
      verificationSteps: Array.isArray(parsedResult.verificationSteps) ? parsedResult.verificationSteps : [],
      risks: Array.isArray(parsedResult.risks) ? parsedResult.risks : []
    };
  }

  public async classifyIssueLabels(params: {
    issue: IssueContext;
    parsed: ParsedIssue;
    repositoryContext: RepositoryAiContext;
    availableLabels: Array<{
      name: string;
      description?: string;
    }>;
    maxLabels: number;
    prompt?: string;
  }): Promise<LabelClassificationResult[]> {
    const content = await requestStructuredJson(this.config, this.apiKey, [
      {
        role: "system",
        text: [
          "You are a GitHub issue label classifier for the current repository.",
          "Choose only labels that are directly supported by the issue content.",
          "Never invent a label name and never return labels outside the provided availableLabels list.",
          "Avoid weak guesses. If the issue does not clearly support a label, leave it out.",
          `Return at most ${params.maxLabels} labels.`,
          "Return JSON only."
        ].join(" ")
      },
      {
        role: "user",
        text: JSON.stringify({
          repositoryContext: params.repositoryContext,
          issue: {
            title: params.issue.title,
            body: params.issue.body,
            labels: params.issue.labels,
            sections: params.parsed.sections
          },
          availableLabels: params.availableLabels,
          maxLabels: params.maxLabels,
          prompt: params.prompt ?? ""
        })
      }
    ], labelClassificationSchema);

    const parsedResult = JSON.parse(extractJsonBlock(content)) as {
      labels?: LabelClassificationResult[];
    };

    return Array.isArray(parsedResult.labels)
      ? parsedResult.labels.map((item) => ({
        name: item.name ?? "",
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
        reason: item.reason ?? ""
      }))
      : [];
  }
}

export function tryCreateProvider(config: ProviderConfig): OpenAiCompatibleProvider | undefined {
  const apiKey = process.env.REPO_BOT_AI_API_KEY ?? "";
  const provider = new OpenAiCompatibleProvider(config, apiKey);
  if (!provider.isAvailable()) {
    core.info("OpenAI-compatible provider is not fully configured. AI features will be skipped or downgraded.");
    return undefined;
  }
  return provider;
}
