import type { IssueAttachmentReference, IssueTextAttachment } from "../core/types.js";
import { sanitizeTextForAiContext } from "../core/aiSafety.js";

export const MAX_ISSUE_TEXT_ATTACHMENTS = 3;
export const MAX_ISSUE_ATTACHMENT_BYTES = 256 * 1024;
export const MAX_ISSUE_ATTACHMENT_CHARS = 24_000;
const MAX_FALLBACK_DOWNLOAD_BYTES = 2 * 1024 * 1024;

const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".log",
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".csv",
  ".trace",
  ".out"
]);

function attachmentExtension(filename: string): string {
  const match = filename.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function isSupportedTextAttachment(reference: IssueAttachmentReference): boolean {
  return SUPPORTED_TEXT_EXTENSIONS.has(attachmentExtension(reference.filename));
}

export function isAllowedGitHubAttachmentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "github.com"
      && /^\/user-attachments\/files\/\d+\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function isAllowedGitHubDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && (hostname === "github.com" || hostname.endsWith(".githubusercontent.com"));
  } catch {
    return false;
  }
}

function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }

  let suspicious = 0;
  for (const byte of bytes.subarray(0, Math.min(bytes.length, 8192))) {
    if (byte === 0) {
      return true;
    }
    if (byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }

  return suspicious / Math.min(bytes.length, 8192) > 0.08;
}

function decodeAttachment(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  return new TextDecoder("utf-8").decode(bytes);
}

async function readBoundedResponse(response: Response): Promise<{
  bytes: Uint8Array;
  truncated: boolean;
}> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes: bytes.length > MAX_ISSUE_ATTACHMENT_BYTES
        ? bytes.subarray(bytes.length - MAX_ISSUE_ATTACHMENT_BYTES)
        : bytes,
      truncated: bytes.length > MAX_ISSUE_ATTACHMENT_BYTES
    };
  }

  const reader = response.body.getReader();
  let tail = new Uint8Array(0);
  let downloaded = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    downloaded += value.length;
    const combined = new Uint8Array(Math.min(MAX_ISSUE_ATTACHMENT_BYTES, tail.length + value.length));
    if (value.length >= MAX_ISSUE_ATTACHMENT_BYTES) {
      combined.set(value.subarray(value.length - MAX_ISSUE_ATTACHMENT_BYTES));
    } else {
      const tailBytesToKeep = combined.length - value.length;
      combined.set(tail.subarray(Math.max(0, tail.length - tailBytesToKeep)), 0);
      combined.set(value, tailBytesToKeep);
    }
    tail = combined;

    if (downloaded >= MAX_FALLBACK_DOWNLOAD_BYTES) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }

  return {
    bytes: tail,
    truncated: truncated || downloaded > MAX_ISSUE_ATTACHMENT_BYTES
  };
}

export async function downloadGitHubTextAttachment(params: {
  reference: IssueAttachmentReference;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<IssueTextAttachment | undefined> {
  if (!isAllowedGitHubAttachmentUrl(params.reference.url) || !isSupportedTextAttachment(params.reference)) {
    return undefined;
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "Accept": "text/plain, application/json, application/octet-stream",
    "User-Agent": "bettergi-repo-bot"
  };
  if (params.token) {
    headers.Authorization = `Bearer ${params.token}`;
  }

  let contentLength = 0;
  try {
    const headResponse = await fetchImpl(params.reference.url, {
      method: "HEAD",
      headers,
      redirect: "follow"
    });
    if (headResponse.ok && (!headResponse.url || isAllowedGitHubDownloadUrl(headResponse.url))) {
      contentLength = Number(headResponse.headers.get("content-length")) || 0;
    }
  } catch {
    // The bounded GET below remains the safe fallback when HEAD is unavailable.
  }

  const requestHeaders = { ...headers };
  if (contentLength > MAX_ISSUE_ATTACHMENT_BYTES) {
    requestHeaders.Range = `bytes=${contentLength - MAX_ISSUE_ATTACHMENT_BYTES}-${contentLength - 1}`;
  }

  const response = await fetchImpl(params.reference.url, {
    headers: requestHeaders,
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`GitHub attachment returned ${response.status}.`);
  }
  if (response.url && !isAllowedGitHubDownloadUrl(response.url)) {
    throw new Error(`GitHub attachment redirected to a disallowed host: ${response.url}`);
  }

  const bounded = await readBoundedResponse(response);
  const bytes = bounded.bytes;
  if (looksBinary(bytes)) {
    return undefined;
  }

  const decoded = sanitizeTextForAiContext(decodeAttachment(bytes)).trim();
  if (!decoded) {
    return undefined;
  }

  const charTruncated = decoded.length > MAX_ISSUE_ATTACHMENT_CHARS;
  const content = charTruncated
    ? decoded.slice(decoded.length - MAX_ISSUE_ATTACHMENT_CHARS)
    : decoded;

  return {
    ...params.reference,
    content,
    truncated: bounded.truncated || charTruncated || response.status === 206 || contentLength > MAX_ISSUE_ATTACHMENT_BYTES
  };
}
