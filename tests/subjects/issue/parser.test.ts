import { describe, expect, it } from "vitest";

import { extractIssueImages, parseIssueBody } from "../../../src/subjects/issue/parser.js";

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
});
