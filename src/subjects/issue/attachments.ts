import * as core from "@actions/core";

import type { ParsedIssue } from "../../core/types.js";
import { isSupportedTextAttachment, MAX_ISSUE_TEXT_ATTACHMENTS } from "../../github/attachments.js";
import type { GitHubGateway } from "../../github/gateway.js";
import { extractIssueAttachments } from "./parser.js";

export async function enrichIssueWithTextAttachments(params: {
  issueNumber: number;
  parsed: ParsedIssue;
  gateway: GitHubGateway;
}): Promise<ParsedIssue> {
  try {
    const comments = await params.gateway.listComments(params.issueNumber);
    const references = [
      ...params.parsed.attachments,
      ...comments
        .filter((comment) => comment.authorType?.toLowerCase() !== "bot")
        .flatMap((comment) => extractIssueAttachments(comment.body))
    ];
    const uniqueReferences = [...new Map(references.map((reference) => [reference.url, reference])).values()]
      .filter(isSupportedTextAttachment)
      .slice(0, MAX_ISSUE_TEXT_ATTACHMENTS);

    if (uniqueReferences.length === 0) {
      return params.parsed;
    }

    const textAttachments = await params.gateway.getIssueTextAttachments(uniqueReferences);
    if (textAttachments.length > 0) {
      core.info(`Including ${textAttachments.length} GitHub-hosted text attachment(s) in AI context.`);
    }

    return {
      ...params.parsed,
      attachments: uniqueReferences,
      textAttachments
    };
  } catch (error) {
    core.warning(`Skip issue text attachments because they could not be loaded: ${String(error)}`);
    return params.parsed;
  }
}
