import { describe, expect, it } from "vitest";

import { createConfig, createIssue, FakeGateway } from "../../helpers/fixtures.js";
import { createReadmeExcerpt, resolveRepositoryAiContext } from "../../../src/subjects/issue/projectContext.js";

describe("projectContext", () => {
  it("normalizes markdown readme text and truncates it", () => {
    const readme = [
      "# BetterGI",
      "",
      "A desktop helper for Genshin Impact.",
      "",
      "```ts",
      "console.log('hidden');",
      "```",
      "",
      "- Built with C# and WPF",
      "- Includes issue automation"
    ].join("\n");

    const excerpt = createReadmeExcerpt(readme, 60);

    expect(excerpt).toContain("BetterGI");
    expect(excerpt).not.toContain("console.log");
    expect(excerpt.length).toBeLessThanOrEqual(60);
  });

  it("uses manual project profile over repository metadata defaults", async () => {
    const config = createConfig();
    config.issues.aiHelp.projectContext.profile = {
      name: "BetterGI",
      aliases: ["BGI", "Better Genshin Impact"],
      summary: "Desktop automation assistant for Genshin Impact.",
      techStack: ["C#", "WPF", ".NET"]
    };

    const issue = createIssue({
      owner: "ddaodan",
      repo: "better-genshin-impact",
      htmlUrl: "https://github.com/ddaodan/better-genshin-impact/issues/2"
    });
    const gateway = new FakeGateway(issue, [], {
      owner: issue.owner,
      repo: issue.repo,
      fullName: `${issue.owner}/${issue.repo}`,
      description: "Fallback description.",
      topics: ["automation"],
      homepage: "https://bettergi.example"
    }, "# BetterGI\n\nREADME summary.");

    const context = await resolveRepositoryAiContext({
      issue,
      gateway,
      config: config.issues.aiHelp.projectContext,
      templateKey: "question"
    });

    expect(context.fullName).toBe("ddaodan/better-genshin-impact");
    expect(context.projectProfile.name).toBe("BetterGI");
    expect(context.projectProfile.aliases).toEqual(["BGI", "Better Genshin Impact"]);
    expect(context.projectProfile.summary).toBe("Desktop automation assistant for Genshin Impact.");
    expect(context.projectProfile.techStack).toEqual(["C#", "WPF", ".NET"]);
    expect(context.readmeExcerpt).toContain("README summary.");
  });
});
