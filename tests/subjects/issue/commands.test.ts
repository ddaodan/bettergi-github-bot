import { describe, expect, it } from "vitest";

import type { OpenAiCompatibleProvider } from "../../../src/providers/openaiCompatible/client.js";
import {
  canExecuteIssueCommentCommand,
  parseIssueCommentCommand,
  runIssueCommentCommand
} from "../../../src/subjects/issue/commands.js";
import {
  createConfig,
  createIssue,
  createIssueCommentContext,
  FakeGateway
} from "../../helpers/fixtures.js";

describe("issue comment commands", () => {
  it("parses commands only when the first plain text line starts with a supported mention", () => {
    const comment = createIssueCommentContext({
      commentBody: [
        "",
        "@BoT /fix",
        "",
        "please regenerate"
      ].join("\n")
    });

    const command = parseIssueCommentCommand({
      comment,
      mentions: ["@bot"]
    });

    expect(command?.command).toBe("fix");
    expect(command?.commandLine).toBe("@BoT /fix");
  });

  it("ignores missing mentions, quoted lines, and bot comments", () => {
    const noMention = parseIssueCommentCommand({
      comment: createIssueCommentContext({
        commentBody: "/fix"
      }),
      mentions: ["@bot"]
    });
    const notFirstPlainTextLine = parseIssueCommentCommand({
      comment: createIssueCommentContext({
        commentBody: [
          "Please regenerate the analysis first.",
          "",
          "@bot /fix"
        ].join("\n")
      }),
      mentions: ["@bot"]
    });
    const botComment = parseIssueCommentCommand({
      comment: createIssueCommentContext({
        commentAuthorType: "Bot",
        commentBody: "@bot /refresh"
      }),
      mentions: ["@bot"]
    });

    expect(noMention).toBeUndefined();
    expect(notFirstPlainTextLine).toBeUndefined();
    expect(botComment).toBeUndefined();
  });

  it("only allows collaborator associations to execute commands", () => {
    const config = createConfig();
    config.issues.commands.enabled = true;
    const allowed = createIssueCommentContext({
      commentAuthorAssociation: "COLLABORATOR",
      commentBody: "@bot /refresh"
    });
    const denied = createIssueCommentContext({
      commentAuthorAssociation: "CONTRIBUTOR",
      commentBody: "@bot /refresh"
    });

    const allowedCommand = parseIssueCommentCommand({
      comment: allowed,
      mentions: config.issues.commands.mentions
    });
    const deniedCommand = parseIssueCommentCommand({
      comment: denied,
      mentions: config.issues.commands.mentions
    });

    expect(allowedCommand).toBeDefined();
    expect(deniedCommand).toBeDefined();
    expect(canExecuteIssueCommentCommand({
      command: allowedCommand!,
      config: config.issues.commands
    })).toBe(true);
    expect(canExecuteIssueCommentCommand({
      command: deniedCommand!,
      config: config.issues.commands
    })).toBe(false);
  });

  it("runs /refresh through the full issue workflow and reacts even when no comments change", async () => {
    const config = createConfig();
    config.issues.commands.enabled = true;
    config.issues.commands.refresh.enabled = true;
    const issue = createIssue({
      labels: ["BUG"]
    });
    const comment = createIssueCommentContext({
      issue,
      commentBody: "@bot /refresh"
    });
    const gateway = new FakeGateway(issue, [], undefined, undefined, comment);
    const command = parseIssueCommentCommand({
      comment,
      mentions: config.issues.commands.mentions
    });

    await runIssueCommentCommand({
      workspace: "E:\\bettergi-github-bot",
      command: command!,
      config,
      gateway
    });

    expect(gateway.comments).toHaveLength(0);
    expect(gateway.commentReactions).toEqual([
      { commentId: comment.commentId, reaction: "eyes" },
      { commentId: comment.commentId, reaction: "rocket" }
    ]);
  });

  it("runs /refresh template validation for command_refresh", async () => {
    const config = createConfig();
    config.issues.commands.enabled = true;
    config.issues.commands.refresh.enabled = true;
    config.issues.autoProcessing.skipCreatedBefore = "2026-02-01";
    const issue = createIssue({
      action: "edited",
      createdAt: "2026-01-01T00:00:00Z",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "Please fill",
        "",
        "## Expected Behavior",
        "The plugin should start successfully"
      ].join("\n")
    });
    const comment = createIssueCommentContext({
      issue,
      commentBody: "@bot /refresh"
    });
    const gateway = new FakeGateway(issue, [], undefined, undefined, comment);
    const command = parseIssueCommentCommand({
      comment,
      mentions: config.issues.commands.mentions
    });

    await runIssueCommentCommand({
      workspace: "E:\\bettergi-github-bot",
      command: command!,
      config,
      gateway
    });

    expect(gateway.comments).toHaveLength(1);
    expect(gateway.comments[0]?.body).toContain("issue-bot:validation");
    expect(gateway.commentReactions.at(-1)?.reaction).toBe("rocket");
  });

  it("creates and updates a dedicated /fix comment without touching the AI comment", async () => {
    const config = createConfig();
    config.issues.commands.enabled = true;
    config.issues.commands.fix.enabled = true;
    const issue = createIssue();
    const comment = createIssueCommentContext({
      issue,
      commentBody: "@bot /fix"
    });
    const gateway = new FakeGateway(issue, [], undefined, undefined, comment);
    let callCount = 0;
    const provider = {
      async generateFixSuggestion() {
        callCount += 1;
        return {
          summary: `fix-${callCount}`,
          candidateFiles: [
            {
              path: "src/config.ts",
              reason: "Config logic lives here."
            }
          ],
          changeSuggestions: ["Normalize the old schema before save."],
          patchDraft: "@@\n- old\n+ new",
          verificationSteps: ["Retry save after migration."],
          risks: ["Migration could affect old files."]
        };
      }
    } as unknown as OpenAiCompatibleProvider;
    const parsedCommand = parseIssueCommentCommand({
      comment,
      mentions: config.issues.commands.mentions
    });

    await runIssueCommentCommand({
      workspace: "E:\\bettergi-github-bot",
      command: parsedCommand!,
      config,
      gateway,
      provider
    });
    await runIssueCommentCommand({
      workspace: "E:\\bettergi-github-bot",
      command: parsedCommand!,
      config,
      gateway,
      provider
    });

    expect(gateway.comments).toHaveLength(1);
    expect(gateway.comments[0]?.body).toContain("issue-bot:fix");
    expect(gateway.comments[0]?.body).toContain("fix-2");
    expect(gateway.comments[0]?.body).not.toContain("issue-bot:ai");
    expect(gateway.commentReactions.filter((item) => item.reaction === "rocket")).toHaveLength(2);
  });

  it("rejects /fix when the issue is invalid, duplicate, closed, or provider is unavailable", async () => {
    const config = createConfig();
    config.issues.commands.enabled = true;
    config.issues.commands.fix.enabled = true;

    const invalidIssue = createIssue({
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "Please fill",
        "",
        "## Expected Behavior",
        "Works"
      ].join("\n")
    });
    const invalidComment = createIssueCommentContext({
      issue: invalidIssue,
      commentBody: "@bot /fix"
    });
    const invalidGateway = new FakeGateway(invalidIssue, [], undefined, undefined, invalidComment);

    await runIssueCommentCommand({
      workspace: "E:\\bettergi-github-bot",
      command: parseIssueCommentCommand({
        comment: invalidComment,
        mentions: config.issues.commands.mentions
      })!,
      config,
      gateway: invalidGateway
    });

    expect(invalidGateway.comments[0]?.body).toContain("还未通过模板检查");
    expect(invalidGateway.commentReactions.at(-1)?.reaction).toBe("confused");

    const duplicateIssue = createIssue({
      labels: ["重复"]
    });
    const duplicateComment = createIssueCommentContext({
      issue: duplicateIssue,
      commentBody: "@bot /fix"
    });
    const duplicateGateway = new FakeGateway(duplicateIssue, [], undefined, undefined, duplicateComment);

    await runIssueCommentCommand({
      workspace: "E:\\bettergi-github-bot",
      command: parseIssueCommentCommand({
        comment: duplicateComment,
        mentions: config.issues.commands.mentions
      })!,
      config,
      gateway: duplicateGateway
    });

    expect(duplicateGateway.comments[0]?.body).toContain("已标记为重复");
    expect(duplicateGateway.commentReactions.at(-1)?.reaction).toBe("confused");

    const closedIssue = createIssue({
      state: "closed"
    });
    const closedComment = createIssueCommentContext({
      issue: closedIssue,
      commentBody: "@bot /fix"
    });
    const closedGateway = new FakeGateway(closedIssue, [], undefined, undefined, closedComment);

    await runIssueCommentCommand({
      workspace: "E:\\bettergi-github-bot",
      command: parseIssueCommentCommand({
        comment: closedComment,
        mentions: config.issues.commands.mentions
      })!,
      config,
      gateway: closedGateway
    });

    expect(closedGateway.comments[0]?.body).toContain("Issue 已关闭");
    expect(closedGateway.commentReactions.at(-1)?.reaction).toBe("confused");

    const unavailableIssue = createIssue();
    const unavailableComment = createIssueCommentContext({
      issue: unavailableIssue,
      commentBody: "@bot /fix"
    });
    const unavailableGateway = new FakeGateway(unavailableIssue, [], undefined, undefined, unavailableComment);

    await runIssueCommentCommand({
      workspace: "E:\\bettergi-github-bot",
      command: parseIssueCommentCommand({
        comment: unavailableComment,
        mentions: config.issues.commands.mentions
      })!,
      config,
      gateway: unavailableGateway
    });

    expect(unavailableGateway.comments[0]?.body).toContain("未配置可用的 AI Provider");
    expect(unavailableGateway.commentReactions.at(-1)?.reaction).toBe("confused");
  });

  it("renders bilingual /fix comments for english issues", async () => {
    const config = createConfig();
    config.issues.commands.enabled = true;
    config.issues.commands.fix.enabled = true;
    const issue = createIssue({
      title: "Config save fails after startup",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "Start the app and save config",
        "",
        "## Expected Behavior",
        "Config should be saved"
      ].join("\n")
    });
    const comment = createIssueCommentContext({
      issue,
      commentBody: "@bot /fix"
    });
    const gateway = new FakeGateway(issue, [], undefined, undefined, comment);
    const provider = {
      async generateFixSuggestion() {
        return {
          summary: "Adjust the save path handling.",
          candidateFiles: [],
          changeSuggestions: ["Normalize the config path before persisting."],
          patchDraft: "@@\n- old\n+ new",
          verificationSteps: ["Save the config again."],
          risks: []
        };
      }
    } as unknown as OpenAiCompatibleProvider;

    await runIssueCommentCommand({
      workspace: "E:\\bettergi-github-bot",
      command: parseIssueCommentCommand({
        comment,
        mentions: config.issues.commands.mentions
      })!,
      config,
      gateway,
      provider
    });

    expect(gateway.comments[0]?.body).toContain("## AI 修复建议");
    expect(gateway.comments[0]?.body).toContain("## AI Fix Suggestion");
  });
});
