import type { GitHubGateway } from "./gateway.js";

function createAnchor(anchor: string): string {
  return `<!-- ${anchor} -->`;
}

export async function upsertAnchoredComment(params: {
  gateway: GitHubGateway;
  issueNumber: number;
  anchor: string;
  body: string;
}): Promise<void> {
  const anchor = createAnchor(params.anchor);
  const fullBody = `${anchor}\n${params.body}`;
  const comments = await params.gateway.listComments(params.issueNumber);
  const existing = comments.find((comment) => comment.body.includes(anchor));

  if (existing) {
    await params.gateway.updateComment(existing.id, fullBody);
    return;
  }

  await params.gateway.createComment(params.issueNumber, fullBody);
}

export async function syncAnchoredComment(params: {
  gateway: GitHubGateway;
  issueNumber: number;
  anchor: string;
  body?: string;
}): Promise<void> {
  const anchor = createAnchor(params.anchor);
  const comments = await params.gateway.listComments(params.issueNumber);
  const existing = comments.find((comment) => comment.body.includes(anchor));

  if (!params.body) {
    if (existing) {
      await params.gateway.deleteComment(existing.id);
    }
    return;
  }

  const fullBody = `${anchor}\n${params.body}`;
  if (existing) {
    await params.gateway.updateComment(existing.id, fullBody);
    return;
  }

  await params.gateway.createComment(params.issueNumber, fullBody);
}
