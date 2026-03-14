import * as core from "@actions/core";

import type { AiHelpResult, DuplicateCandidate, DuplicateReviewResult, IssueContext, ProviderConfig } from "../../core/types.js";

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

async function requestChatCompletion(
  config: ProviderConfig,
  apiKey: string,
  messages: Array<{ role: "system" | "user"; content: string }>
): Promise<string> {
  const endpointBase = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(new URL("chat/completions", endpointBase), {
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
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`AI provider returned ${response.status}: ${await response.text()}`);
    }

    const json = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI provider returned an empty message.");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
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
    const content = await requestChatCompletion(this.config, this.apiKey, [
      {
        role: "system",
        content: "你是一个 GitHub 仓库机器人。请判断两个 issue 是否描述同一个问题，只返回 JSON：{\"duplicate\": boolean, \"confidence\": number, \"reason\": string}。confidence 取 0 到 1。"
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
    ]);

    const parsed = JSON.parse(extractJsonBlock(content)) as DuplicateReviewResult;
    return {
      duplicate: Boolean(parsed.duplicate),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: parsed.reason ?? ""
    };
  }

  public async generateHelp(issue: IssueContext, sections: Record<string, string>): Promise<AiHelpResult> {
    const content = await requestChatCompletion(this.config, this.apiKey, [
      {
        role: "system",
        content: "你是一个 GitHub Issue 助手机器人。请根据 issue 内容给出简洁、可执行的排查建议，只返回 JSON：{\"summary\": string, \"possibleCauses\": string[], \"troubleshootingSteps\": string[], \"missingInformation\": string[]}。"
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
    ]);

    const parsed = JSON.parse(extractJsonBlock(content)) as AiHelpResult;
    return {
      summary: parsed.summary ?? "未能生成摘要。",
      possibleCauses: Array.isArray(parsed.possibleCauses) ? parsed.possibleCauses : [],
      troubleshootingSteps: Array.isArray(parsed.troubleshootingSteps) ? parsed.troubleshootingSteps : [],
      missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation : []
    };
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
