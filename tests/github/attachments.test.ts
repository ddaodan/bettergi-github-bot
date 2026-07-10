import { describe, expect, it, vi } from "vitest";

import {
  downloadGitHubTextAttachment,
  isAllowedGitHubAttachmentUrl,
  isSupportedTextAttachment
} from "../../src/github/attachments.js";

describe("GitHub issue text attachments", () => {
  it("allows only GitHub user attachment file URLs with supported text extensions", () => {
    expect(isAllowedGitHubAttachmentUrl("https://github.com/user-attachments/files/123/app.log")).toBe(true);
    expect(isAllowedGitHubAttachmentUrl("https://attacker.example/user-attachments/files/123/app.log")).toBe(false);
    expect(isSupportedTextAttachment({
      url: "https://github.com/user-attachments/files/123/app.log",
      filename: "app.log"
    })).toBe(true);
    expect(isSupportedTextAttachment({
      url: "https://github.com/user-attachments/files/123/app.zip",
      filename: "app.zip"
    })).toBe(false);
  });

  it("downloads text, requests a bounded tail, and redacts sensitive tokens", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: {
          "content-length": String(300 * 1024)
        }
      }))
      .mockResolvedValueOnce(new Response(
        "startup failed\napi_key=sk-abcdefghijklmnopqrstuvwxyz123456\nfinal error",
        { status: 206 }
      )) as unknown as typeof fetch;

    const attachment = await downloadGitHubTextAttachment({
      reference: {
        url: "https://github.com/user-attachments/files/123/app.log",
        filename: "app.log"
      },
      token: "test-token",
      fetchImpl
    });

    expect(attachment?.content).toContain("startup failed");
    expect(attachment?.content).toContain("[REDACTED]");
    expect(attachment?.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(attachment?.truncated).toBe(true);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://github.com/user-attachments/files/123/app.log",
      expect.objectContaining({
        headers: expect.objectContaining({
          Range: expect.stringMatching(/^bytes=\d+-\d+$/),
          Authorization: "Bearer test-token"
        })
      })
    );
  });

  it("skips binary attachments", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: {
          "content-length": "4"
        }
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 2, 3]))) as unknown as typeof fetch;
    const attachment = await downloadGitHubTextAttachment({
      reference: {
        url: "https://github.com/user-attachments/files/123/app.log",
        filename: "app.log"
      },
      fetchImpl
    });

    expect(attachment).toBeUndefined();
  });
});
