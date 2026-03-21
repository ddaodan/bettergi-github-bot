import { describe, expect, it } from "vitest";

import {
  containsSensitiveText,
  isAllowedAiImageUrl,
  isSensitivePath,
  partitionIssueImagesForAi,
  sanitizeAiHelpResultForComment,
  sanitizeFixSuggestionForComment
} from "../../src/core/aiSafety.js";

describe("aiSafety", () => {
  it("matches allowed GitHub-hosted image URLs only", () => {
    expect(isAllowedAiImageUrl("https://github.com/user-attachments/assets/123")).toBe(true);
    expect(isAllowedAiImageUrl("https://private-user-images.githubusercontent.com/123/test.png")).toBe(true);
    expect(isAllowedAiImageUrl("https://attacker.example/test.png")).toBe(false);
  });

  it("partitions issue images by allowed host", () => {
    const result = partitionIssueImagesForAi([
      {
        url: "https://github.com/user-attachments/assets/123",
        altText: "github"
      },
      {
        url: "https://attacker.example/test.png",
        altText: "attacker"
      }
    ]);

    expect(result.allowed).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.url).toBe("https://attacker.example/test.png");
  });

  it("detects sensitive paths and text", () => {
    expect(isSensitivePath(".env.production")).toBe(true);
    expect(isSensitivePath("config/test.pem")).toBe(true);
    expect(isSensitivePath(".ssh/id_rsa")).toBe(true);
    expect(isSensitivePath("src/index.ts")).toBe(false);

    expect(containsSensitiveText("Authorization: Bearer ghp_1234567890abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(containsSensitiveText("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----")).toBe(true);
    expect(containsSensitiveText("plain text only")).toBe(false);
  });

  it("replaces prompt-injection dumps and redacts sensitive text in AI help comments", () => {
    const result = sanitizeAiHelpResultForComment({
      mode: "zh",
      blockedTexts: [
        "This is the full original issue body that should never be copied verbatim into a public comment because it is too long and too detailed."
      ],
      help: {
        summary: JSON.stringify({
          repositoryContext: {
            fullName: "octo/repo",
            readmeExcerpt: "README"
          },
          codeContext: {
            files: []
          }
        }),
        possibleCauses: [
          "Authorization: Bearer ghp_1234567890abcdefghijklmnopqrstuvwxyz"
        ],
        troubleshootingSteps: [
          "This is the full original issue body that should never be copied verbatim into a public comment because it is too long and too detailed."
        ],
        missingInformation: []
      }
    });

    expect(result.summary).toBe("出于安全原因，无法公开转储内部上下文或敏感信息。");
    expect(result.possibleCauses[0]).toContain("[REDACTED]");
    expect(result.troubleshootingSteps[0]).toBe("出于安全原因，无法公开转储内部上下文或敏感信息。");
  });

  it("omits sensitive patch drafts and filters sensitive candidate files", () => {
    const result = sanitizeFixSuggestionForComment({
      mode: "zh-en",
      suggestion: {
        summary: "Summarize the fix.",
        candidateFiles: [
          { path: ".env.production", reason: "contains config" },
          { path: "src/index.ts", reason: "entry point" }
        ],
        changeSuggestions: ["Rotate the secret if it was exposed."],
        patchDraft: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
        verificationSteps: ["Run tests."],
        risks: []
      }
    });

    expect(result.candidateFiles).toEqual([
      { path: "src/index.ts", reason: "entry point" }
    ]);
    expect(result.patchDraft).toContain("Omitted because it may contain sensitive content");
  });
});
