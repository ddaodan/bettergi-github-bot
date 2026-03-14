import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleProvider } from "../../../src/providers/openaiCompatible/client.js";

describe("OpenAiCompatibleProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves /v1 base path when building chat completions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "ok",
                  possibleCauses: [],
                  troubleshootingSteps: [],
                  missingInformation: []
                })
              }
            }
          ]
        };
      }
    });

    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiCompatibleProvider({
      enabled: true,
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5-mini",
      timeoutMs: 30000
    }, "test-key");

    await provider.generateHelp({
      kind: "issue",
      owner: "octo",
      repo: "repo",
      number: 1,
      title: "Example",
      body: "Body",
      state: "open",
      labels: [],
      htmlUrl: "https://example.test/issues/1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      action: "opened"
    }, {});

    const firstCall = fetchMock.mock.calls[0]?.[0];
    expect(String(firstCall)).toBe("https://api.openai.com/v1/chat/completions");
  });
});
