import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { collectRepositoryCodeContext } from "../../../src/subjects/issue/codeContext.js";
import { parseIssueBody } from "../../../src/subjects/issue/parser.js";
import { createIssue } from "../../helpers/fixtures.js";

describe("collectRepositoryCodeContext", () => {
  it("prefers matching source files and skips excluded directories", async () => {
    const workspace = path.join(os.tmpdir(), `repo-bot-code-context-${Date.now()}`);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await mkdir(path.join(workspace, "dist"), { recursive: true });
    await writeFile(
      path.join(workspace, "src", "configSave.ts"),
      "export function saveConfig() { throw new Error('save failed'); }\n"
    );
    await writeFile(
      path.join(workspace, "dist", "configSave.js"),
      "compiled output should be ignored"
    );

    const issue = createIssue({
      title: "Config save failed",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "save config",
        "",
        "## Expected Behavior",
        "config saves successfully"
      ].join("\n")
    });

    const context = await collectRepositoryCodeContext({
      workspace,
      issue,
      parsed: parseIssueBody(issue.body),
      repositoryContext: {
        owner: "octo",
        repo: "repo",
        fullName: "octo/repo",
        description: "",
        topics: [],
        homepage: "",
        issueUrl: issue.htmlUrl,
        templateKey: "bug",
        readmeExcerpt: "",
        projectProfile: {
          name: "Repo",
          aliases: [],
          summary: "",
          techStack: []
        }
      }
    });

    expect(context.fallbackUsed).toBe(false);
    expect(context.files.some((item) => item.path === "src/configSave.ts")).toBe(true);
    expect(context.files.some((item) => item.path === "dist/configSave.js")).toBe(false);
  });

  it("falls back to README and entry files when no keyword match is found", async () => {
    const workspace = path.join(os.tmpdir(), `repo-bot-code-context-fallback-${Date.now()}`);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "README.md"), "# Example\n\nRepository overview.");
    await writeFile(path.join(workspace, "package.json"), "{ \"name\": \"example\" }");
    await writeFile(path.join(workspace, "src", "index.ts"), "export const version = '1.0.0';");

    const issue = createIssue({
      title: "Database transaction lock timeout",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "trigger the lock timeout",
        "",
        "## Expected Behavior",
        "database transaction should complete"
      ].join("\n")
    });

    const context = await collectRepositoryCodeContext({
      workspace,
      issue,
      parsed: parseIssueBody(issue.body),
      repositoryContext: {
        owner: "octo",
        repo: "repo",
        fullName: "octo/repo",
        description: "",
        topics: [],
        homepage: "",
        issueUrl: issue.htmlUrl,
        templateKey: "bug",
        readmeExcerpt: "Example README excerpt.",
        projectProfile: {
          name: "",
          aliases: [],
          summary: "",
          techStack: []
        }
      }
    });

    expect(context.fallbackUsed).toBe(true);
    expect(context.files.some((item) => item.path === "README.md")).toBe(true);
    expect(context.files.some((item) => item.path === "package.json" || item.path === "src/index.ts")).toBe(true);
  });

  it("skips sensitive files and sensitive text even when keywords match", async () => {
    const workspace = path.join(os.tmpdir(), `repo-bot-code-context-sensitive-${Date.now()}`);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(
      path.join(workspace, "src", "databaseService.ts"),
      "export function connectDatabase() { return 'ok'; }\n"
    );
    await writeFile(
      path.join(workspace, "appsettings.Production.json"),
      "{ \"ConnectionStrings\": { \"Default\": \"Server=db;User Id=admin;Password=secret123\" } }"
    );
    await writeFile(
      path.join(workspace, "src", "database-token.txt"),
      "Authorization: Bearer ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    );

    const issue = createIssue({
      title: "Database connection failed",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "connect database",
        "",
        "## Expected Behavior",
        "database connection succeeds"
      ].join("\n")
    });

    const context = await collectRepositoryCodeContext({
      workspace,
      issue,
      parsed: parseIssueBody(issue.body),
      repositoryContext: {
        owner: "octo",
        repo: "repo",
        fullName: "octo/repo",
        description: "",
        topics: [],
        homepage: "",
        issueUrl: issue.htmlUrl,
        templateKey: "bug",
        readmeExcerpt: "",
        projectProfile: {
          name: "Repo",
          aliases: [],
          summary: "",
          techStack: []
        }
      }
    });

    expect(context.files.some((item) => item.path === "src/databaseService.ts")).toBe(true);
    expect(context.files.some((item) => item.path === "appsettings.Production.json")).toBe(false);
    expect(context.files.some((item) => item.path === "src/database-token.txt")).toBe(false);
  });

  it("filters sensitive fallback files", async () => {
    const workspace = path.join(os.tmpdir(), `repo-bot-code-context-fallback-sensitive-${Date.now()}`);
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(
      path.join(workspace, "README.md"),
      "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"
    );
    await writeFile(path.join(workspace, "package.json"), "{ \"name\": \"example\" }");

    const issue = createIssue({
      title: "Scheduler lock timeout",
      body: [
        "<!-- issue-template: bug -->",
        "",
        "## Environment",
        "Windows 11",
        "",
        "## Steps to Reproduce",
        "trigger the timeout",
        "",
        "## Expected Behavior",
        "scheduler finishes normally"
      ].join("\n")
    });

    const context = await collectRepositoryCodeContext({
      workspace,
      issue,
      parsed: parseIssueBody(issue.body),
      repositoryContext: {
        owner: "octo",
        repo: "repo",
        fullName: "octo/repo",
        description: "",
        topics: [],
        homepage: "",
        issueUrl: issue.htmlUrl,
        templateKey: "bug",
        readmeExcerpt: "-----BEGIN PRIVATE KEY----- secret -----END PRIVATE KEY-----",
        projectProfile: {
          name: "",
          aliases: [],
          summary: "",
          techStack: []
        }
      }
    });

    expect(context.fallbackUsed).toBe(true);
    expect(context.files.some((item) => item.path === "README.md")).toBe(false);
    expect(context.files.some((item) => item.path === "package.json")).toBe(true);
  });
});
