import { describe, expect, it } from "vitest";

import { extractIssueImages, matchTemplate, parseIssueBody } from "../../../src/subjects/issue/parser.js";

describe("issue parser", () => {
  it("extracts markdown and html issue images without duplicates", () => {
    const body = [
      "<!-- issue-template: bug -->",
      "",
      "## Problem",
      "See images below.",
      "",
      "![Screenshot](https://github.com/user-attachments/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)",
      "",
      "<img alt=\"Dialog\" src=\"https://github.com/user-attachments/assets/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\" />",
      "",
      "https://github.com/user-attachments/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    ].join("\n");

    expect(extractIssueImages(body)).toEqual([
      {
        url: "https://github.com/user-attachments/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        altText: "Screenshot"
      },
      {
        url: "https://github.com/user-attachments/assets/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        altText: "Dialog"
      }
    ]);
  });

  it("includes extracted images in parsed issue output", () => {
    const body = [
      "<!-- issue-template: bug -->",
      "",
      "## Problem",
      "Broken UI",
      "",
      "<img alt=\"Broken UI\" src=\"https://github.com/user-attachments/assets/cccccccc-cccc-cccc-cccc-cccccccccccc\" />"
    ].join("\n");

    const parsed = parseIssueBody(body);

    expect(parsed.images).toEqual([
      {
        url: "https://github.com/user-attachments/assets/cccccccc-cccc-cccc-cccc-cccccccccccc",
        altText: "Broken UI"
      }
    ]);
  });

  it("matches templates by title prefix when marker is absent", () => {
    const parsed = parseIssueBody([
      "## Environment",
      "Windows",
      "",
      "## Steps to Reproduce",
      "1. Repro",
      "",
      "## Expected Behavior",
      "Should work"
    ].join("\n"));

    const template = matchTemplate(parsed, [
      {
        key: "bug",
        detect: {
          markers: ["bug"],
          titlePrefixes: ["[bug]"]
        },
        requiredSections: [],
        labels: {
          whenValid: [],
          whenInvalid: []
        }
      }
    ], undefined, "[bug] Save failed");

    expect(template?.key).toBe("bug");
  });

  it("matches issue forms by section headings when marker and title prefix are absent", () => {
    const parsed = parseIssueBody([
      "## Feature Request",
      "Need batch mode",
      "",
      "## Use Case",
      "Reduce repetitive actions"
    ].join("\n"));

    const template = matchTemplate(parsed, [
      {
        key: "bug",
        detect: {
          markers: ["bug"],
          titlePrefixes: ["[bug]"]
        },
        requiredSections: [
          {
            id: "environment",
            aliases: ["Environment"]
          }
        ],
        labels: {
          whenValid: [],
          whenInvalid: []
        }
      },
      {
        key: "feature",
        detect: {
          markers: ["feature"],
          titlePrefixes: ["[feature]"]
        },
        requiredSections: [
          {
            id: "request",
            aliases: ["Feature Request"]
          },
          {
            id: "scenario",
            aliases: ["Use Case"]
          }
        ],
        labels: {
          whenValid: [],
          whenInvalid: []
        }
      }
    ]);

    expect(template?.key).toBe("feature");
  });
});
