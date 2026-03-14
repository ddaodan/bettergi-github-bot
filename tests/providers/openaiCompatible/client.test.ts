import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleProvider } from "../../../src/providers/openaiCompatible/client.js";

function createProvider(overrides: Partial<ConstructorParameters<typeof OpenAiCompatibleProvider>[0]> = {}): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    apiStyle: "auto",
    timeoutMs: 30000,
    ...overrides
  }, "test-key");
}

function createIssue() {
  return {
    kind: "issue" as const,
    owner: "octo",
    repo: "repo",
    number: 1,
    title: "Example",
    body: "Body",
    state: "open" as const,
    labels: [],
    htmlUrl: "https://example.test/issues/1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    action: "opened"
  };
}

describe("OpenAiCompatibleProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses responses API first in auto mode and preserves /v1 base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            summary: "ok",
            possibleCauses: [],
            troubleshootingSteps: [],
            missingInformation: []
          })
        };
      }
    });

    vi.stubGlobal("fetch", fetchMock);

    await createProvider().generateHelp(createIssue(), {});

    const firstCall = fetchMock.mock.calls[0]?.[0];
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(String(firstCall)).toBe("https://api.openai.com/v1/responses");
    expect(body.text.format.type).toBe("json_schema");
  });

  it("falls back to chat/completions when responses API is unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        async text() {
          return "responses endpoint not found";
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "fallback",
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

    const result = await createProvider().generateHelp(createIssue(), {});

    expect(result.summary).toBe("fallback");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/responses");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("retries with /v1-prefixed responses endpoint when baseUrl has no path", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        async text() {
          return "404 page not found";
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              summary: "versioned path",
              possibleCauses: [],
              troubleshootingSteps: [],
              missingInformation: []
            })
          };
        }
      });

    vi.stubGlobal("fetch", fetchMock);

    const result = await createProvider({
      baseUrl: "https://cliproxy.ddaodan.cc/",
      apiStyle: "responses"
    }).generateHelp(createIssue(), {});

    expect(result.summary).toBe("versioned path");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://cliproxy.ddaodan.cc/responses");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://cliproxy.ddaodan.cc/v1/responses");
  });

  it("uses chat/completions only when apiStyle is chat_completions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "chat only",
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

    const result = await createProvider({
      apiStyle: "chat_completions"
    }).generateHelp(createIssue(), {});

    expect(result.summary).toBe("chat only");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
  });
});
