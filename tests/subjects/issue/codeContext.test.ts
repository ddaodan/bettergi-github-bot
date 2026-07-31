import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { IssueCodeContextConfig, RepositoryAiContext } from "../../../src/core/types.js";
import { collectRepositoryCodeContext } from "../../../src/subjects/issue/codeContext.js";
import { parseIssueBody } from "../../../src/subjects/issue/parser.js";
import { createIssue, FakeGateway } from "../../helpers/fixtures.js";

function createRepositoryContext(issue: ReturnType<typeof createIssue>): RepositoryAiContext {
  return {
    owner: issue.owner,
    repo: issue.repo,
    fullName: issue.owner + "/" + issue.repo,
    description: "",
    topics: [],
    homepage: "",
    issueUrl: issue.htmlUrl,
    templateKey: "bug",
    readmeExcerpt: "",
    projectProfile: {
      name: "BetterGI Scripts",
      aliases: [],
      summary: "",
      techStack: ["JavaScript"]
    }
  };
}

const githubCodeContextConfig: IssueCodeContextConfig = {
  source: "github",
  includeInAiHelp: true,
  includeInFix: true,
  indexPath: "repo.json",
  indexRoot: "repo",
  categorySectionAliases: ["涉及范围"],
  nameSectionAliases: ["相关脚本名称与版本"],
  pathSectionAliases: ["脚本链接或仓库路径"],
  categoryRoots: {
    "JS 脚本": ["repo/js"],
    "地图追踪": ["repo/pathing"]
  }
};

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

  it("resolves a script display name through repo.json and reads only its files", async () => {
    const issue = createIssue({
      owner: "babalae",
      repo: "bettergi-scripts-list",
      title: "[bug] 莉奈娅挖矿内存异常",
      body: [
        "### 涉及范围",
        "JS 脚本",
        "",
        "### 相关脚本名称与版本",
        "莉奈娅挖矿一条龙 0.2.5",
        "",
        "### 脚本链接或仓库路径",
        "_No response_",
        "",
        "### 问题描述",
        "运行挖矿脚本后内存持续增长"
      ].join("\n")
    });
    const gateway = new FakeGateway(issue);
    gateway.repositoryTextFiles.set("repo.json", JSON.stringify({
      indexes: [{
        name: "js",
        type: "directory",
        children: [{
          name: "LinneaMining",
          type: "directory",
          version: "0.2.5",
          author: "example",
          description: "莉奈娅挖矿一条龙~|~不分矿种，稳定刷新即挖"
        }]
      }]
    }));
    gateway.repositoryDirectories.set("repo/js/LinneaMining", [
      { path: "repo/js/LinneaMining/README.md", name: "README.md", type: "file", size: 100, sha: "1" },
      { path: "repo/js/LinneaMining/manifest.json", name: "manifest.json", type: "file", size: 100, sha: "2" },
      { path: "repo/js/LinneaMining/main.js", name: "main.js", type: "file", size: 100, sha: "3" }
    ]);
    gateway.repositoryTextFiles.set("repo/js/LinneaMining/README.md", "# 莉奈娅挖矿一条龙\n内存与路径说明");
    gateway.repositoryTextFiles.set("repo/js/LinneaMining/manifest.json", "{\"name\":\"莉奈娅挖矿一条龙\"}");
    gateway.repositoryTextFiles.set("repo/js/LinneaMining/main.js", "function runMining() { return true; }");

    const context = await collectRepositoryCodeContext({
      workspace: "",
      issue,
      parsed: parseIssueBody(issue.body),
      repositoryContext: createRepositoryContext(issue),
      config: githubCodeContextConfig,
      gateway
    });

    expect(context.resolution?.status).toBe("resolved");
    expect(context.targets?.[0]?.path).toBe("repo/js/LinneaMining");
    expect(context.targets?.[0]?.version).toBe("0.2.5");
    expect(context.files.map((file) => file.path)).toContain("repo/js/LinneaMining/main.js");
  });

  it("prefers an explicit repository path and rejects paths outside configured roots", async () => {
    const issue = createIssue({
      owner: "babalae",
      repo: "bettergi-scripts-list",
      body: [
        "### 涉及范围",
        "JS 脚本",
        "",
        "### 相关脚本名称与版本",
        "任意名称",
        "",
        "### 脚本链接或仓库路径",
        "repo/js/ExactScript"
      ].join("\n")
    });
    const gateway = new FakeGateway(issue);
    gateway.repositoryDirectories.set("repo/js/ExactScript", [
      { path: "repo/js/ExactScript/main.js", name: "main.js", type: "file", size: 20, sha: "1" }
    ]);
    gateway.repositoryTextFiles.set("repo/js/ExactScript/main.js", "export const ok = true;");

    const resolved = await collectRepositoryCodeContext({
      workspace: "",
      issue,
      parsed: parseIssueBody(issue.body),
      repositoryContext: createRepositoryContext(issue),
      config: githubCodeContextConfig,
      gateway
    });
    expect(resolved.targets?.[0]?.path).toBe("repo/js/ExactScript");

    const outsideIssue = {
      ...issue,
      body: issue.body.replace("repo/js/ExactScript", ".github/workflows/release.yml")
    };
    const rejected = await collectRepositoryCodeContext({
      workspace: "",
      issue: outsideIssue,
      parsed: parseIssueBody(outsideIssue.body),
      repositoryContext: createRepositoryContext(outsideIssue),
      config: githubCodeContextConfig,
      gateway
    });
    expect(rejected.resolution?.status).toBe("not_found");
    expect(rejected.files).toEqual([]);
  });

  it("reports ambiguous display-name matches without reading candidate files", async () => {
    const issue = createIssue({
      owner: "babalae",
      repo: "bettergi-scripts-list",
      body: [
        "### 涉及范围",
        "JS 脚本",
        "",
        "### 相关脚本名称与版本",
        "同名脚本"
      ].join("\n")
    });
    const gateway = new FakeGateway(issue);
    gateway.repositoryTextFiles.set("repo.json", JSON.stringify({
      indexes: [{
        name: "js",
        type: "directory",
        children: [
          { name: "First", type: "directory", description: "同名脚本~|~一" },
          { name: "Second", type: "directory", description: "同名脚本~|~二" }
        ]
      }]
    }));

    const context = await collectRepositoryCodeContext({
      workspace: "",
      issue,
      parsed: parseIssueBody(issue.body),
      repositoryContext: createRepositoryContext(issue),
      config: githubCodeContextConfig,
      gateway
    });

    expect(context.resolution?.status).toBe("ambiguous");
    expect(context.resolution?.candidatePaths).toEqual([
      "repo/js/First",
      "repo/js/Second"
    ]);
    expect(context.files).toEqual([]);
  });

  it("filters sensitive remote paths and contents", async () => {
    const issue = createIssue({
      owner: "babalae",
      repo: "bettergi-scripts-list",
      body: [
        "### 涉及范围",
        "JS 脚本",
        "",
        "### 脚本链接或仓库路径",
        "repo/js/SafeScript"
      ].join("\n")
    });
    const gateway = new FakeGateway(issue);
    gateway.repositoryDirectories.set("repo/js/SafeScript", [
      { path: "repo/js/SafeScript/README.md", name: "README.md", type: "file", size: 20, sha: "1" },
      { path: "repo/js/SafeScript/.env", name: ".env", type: "file", size: 20, sha: "2" },
      { path: "repo/js/SafeScript/main.js", name: "main.js", type: "file", size: 80, sha: "3" }
    ]);
    gateway.repositoryTextFiles.set("repo/js/SafeScript/README.md", "# Safe Script\nUsage notes.");
    gateway.repositoryTextFiles.set("repo/js/SafeScript/.env", "TOKEN=secret");
    gateway.repositoryTextFiles.set(
      "repo/js/SafeScript/main.js",
      "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"
    );

    const context = await collectRepositoryCodeContext({
      workspace: "",
      issue,
      parsed: parseIssueBody(issue.body),
      repositoryContext: createRepositoryContext(issue),
      config: githubCodeContextConfig,
      gateway
    });

    expect(context.files.map((file) => file.path)).toEqual(["repo/js/SafeScript/README.md"]);
  });
});
