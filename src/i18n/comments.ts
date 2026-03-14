import type { AiHelpResult, CommentMode, DuplicateCandidate } from "../core/types.js";

function bilingual(mode: CommentMode, zh: string, en: string): string {
  if (mode === "zh") {
    return zh;
  }
  return `${zh}\n\n---\n\n${en}`;
}

export function renderValidationComment(params: {
  mode: CommentMode;
  valid: boolean;
  templateKey?: string;
  missingSections: string[];
}): string {
  if (params.valid) {
    return bilingual(
      params.mode,
      `## 模板检查结果\n\n已通过模板检查。当前识别模板：\`${params.templateKey ?? "unknown"}\`。`,
      `## Template Check Result\n\nThe issue passed template validation. Detected template: \`${params.templateKey ?? "unknown"}\`.`
    );
  }

  const zhMissing = params.missingSections.map((item) => `- ${item}`).join("\n") || "- 无";
  const enMissing = params.missingSections.map((item) => `- ${item}`).join("\n") || "- None";

  return bilingual(
    params.mode,
    `## 模板检查结果\n\nIssue 未通过模板检查，请补充以下必填内容：\n${zhMissing}`,
    `## Template Check Result\n\nThis issue did not pass template validation. Please complete the following required sections:\n${enMissing}`
  );
}

export function renderDuplicateComment(params: {
  mode: CommentMode;
  duplicateOf: DuplicateCandidate;
  confidence: number;
}): string {
  const duplicateLine = `Duplicate of #${params.duplicateOf.number}`;
  const zh = `${duplicateLine}\n\n## 重复 Issue 处理\n\n检测到该 Issue 与 #${params.duplicateOf.number} 高度相似，已按重复问题关闭。\n\n- 原 Issue：${params.duplicateOf.htmlUrl}\n- 置信度：${params.confidence.toFixed(2)}`;
  const en = `${duplicateLine}\n\n## Duplicate Issue Handling\n\nThis issue is highly similar to #${params.duplicateOf.number} and has been closed as a duplicate.\n\n- Canonical issue: ${params.duplicateOf.htmlUrl}\n- Confidence: ${params.confidence.toFixed(2)}`;

  return params.mode === "zh" ? zh : `${zh}\n\n---\n\n${en}`;
}

export function renderAiHelpComment(params: {
  mode: CommentMode;
  help: AiHelpResult;
}): string {
  const zh = [
    "## AI 分析建议",
    "",
    `### 问题概述\n${params.help.summary}`,
    "",
    "### 可能原因",
    ...params.help.possibleCauses.map((item) => `- ${item}`),
    "",
    "### 建议排查步骤",
    ...params.help.troubleshootingSteps.map((item) => `- ${item}`),
    "",
    "### 仍需补充的信息",
    ...(params.help.missingInformation.length > 0 ? params.help.missingInformation.map((item) => `- ${item}`) : ["- 暂无"])
  ].join("\n");

  if (params.mode === "zh") {
    return zh;
  }

  const en = [
    "## AI Guidance",
    "",
    `### Summary\n${params.help.summary}`,
    "",
    "### Possible Causes",
    ...params.help.possibleCauses.map((item) => `- ${item}`),
    "",
    "### Suggested Troubleshooting Steps",
    ...params.help.troubleshootingSteps.map((item) => `- ${item}`),
    "",
    "### Additional Information Needed",
    ...(params.help.missingInformation.length > 0 ? params.help.missingInformation.map((item) => `- ${item}`) : ["- None"])
  ].join("\n");

  return `${zh}\n\n---\n\n${en}`;
}
