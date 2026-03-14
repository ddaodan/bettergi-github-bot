import type { CommentMode, RuntimeConfig } from "../core/types.js";

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

export function detectCommentMode(text: string, runtime: RuntimeConfig): CommentMode {
  if (runtime.languageMode === "zh" || runtime.languageMode === "zh-en") {
    return runtime.languageMode;
  }

  const chineseCharacters = countMatches(text, /[\u3400-\u9fff]/g);
  const englishWords = countMatches(text, /\b[a-zA-Z]{2,}\b/g);

  if (englishWords >= 12 && englishWords > chineseCharacters * 2) {
    return "zh-en";
  }

  return "zh";
}
