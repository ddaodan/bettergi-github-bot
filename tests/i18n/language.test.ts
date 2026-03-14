import { describe, expect, it } from "vitest";

import { detectCommentMode } from "../../src/i18n/language.js";

describe("detectCommentMode", () => {
  it("keeps Chinese mode for Chinese-dominant text", () => {
    expect(detectCommentMode("这是一个中文 issue，描述插件崩溃和复现步骤。", {
      languageMode: "auto",
      dryRun: false
    })).toBe("zh");
  });

  it("switches to bilingual mode for English-dominant text", () => {
    expect(detectCommentMode("Plugin crashes on startup when loading configuration after the latest update. Steps to reproduce are listed below in English only.", {
      languageMode: "auto",
      dryRun: false
    })).toBe("zh-en");
  });
});
