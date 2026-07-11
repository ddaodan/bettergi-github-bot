import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import type { RepoBotConfig } from "../core/types.js";
import { repoBotConfigSchema, type RepoBotConfigInput } from "./schema.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonOverrides(value: string | undefined, source: string): unknown {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${String(error)}`);
  }
}

type EnvironmentValueKind = "string" | "boolean" | "number" | "json";

interface EnvironmentOverrideDefinition {
  name: string;
  path: string[];
  kind: EnvironmentValueKind;
}

function environmentOverride(
  path: string[],
  kind: EnvironmentValueKind,
  name?: string
): EnvironmentOverrideDefinition {
  const generatedName = `REPO_BOT_${path
    .map((segment) => segment.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase())
    .join("_")}`;
  return {
    name: name ?? generatedName,
    path,
    kind
  };
}

export const repoBotConfigEnvironmentVariables: EnvironmentOverrideDefinition[] = [
  environmentOverride(["runtime", "languageMode"], "string"),
  environmentOverride(["runtime", "dryRun"], "boolean"),
  environmentOverride(["providers", "openAiCompatible", "enabled"], "boolean", "REPO_BOT_AI_ENABLED"),
  environmentOverride(["providers", "openAiCompatible", "baseUrl"], "string", "REPO_BOT_AI_BASE_URL"),
  environmentOverride(["providers", "openAiCompatible", "model"], "string", "REPO_BOT_AI_MODEL"),
  environmentOverride(["providers", "openAiCompatible", "apiStyle"], "string", "REPO_BOT_AI_API_STYLE"),
  environmentOverride(["providers", "openAiCompatible", "timeoutMs"], "number", "REPO_BOT_AI_TIMEOUT_MS"),
  environmentOverride(["issues", "autoProcessing", "skipCreatedBefore"], "string"),
  environmentOverride(["issues", "titleGeneration", "enabled"], "boolean"),
  environmentOverride(["issues", "titleGeneration", "maxLength"], "number"),
  environmentOverride(["issues", "titleGeneration", "detectMismatch"], "boolean"),
  environmentOverride(["issues", "titleGeneration", "mismatchConfidence"], "number"),
  environmentOverride(["issues", "titleGeneration", "placeholderTitles"], "json"),
  environmentOverride(["issues", "validation", "enabled"], "boolean"),
  environmentOverride(["issues", "validation", "fallbackTemplateKey"], "string"),
  environmentOverride(["issues", "validation", "commentAnchor"], "string"),
  environmentOverride(["issues", "validation", "templates"], "json"),
  environmentOverride(["issues", "validation", "duplicateDetection", "enabled"], "boolean"),
  environmentOverride(["issues", "validation", "duplicateDetection", "bypassLabels"], "json"),
  environmentOverride(["issues", "validation", "duplicateDetection", "duplicateLabel"], "string"),
  environmentOverride(["issues", "validation", "duplicateDetection", "searchResultLimit"], "number"),
  environmentOverride(["issues", "validation", "duplicateDetection", "candidateLimit"], "number"),
  environmentOverride(["issues", "validation", "duplicateDetection", "aiReviewMaxCandidates"], "number"),
  environmentOverride(["issues", "validation", "duplicateDetection", "thresholds", "exact"], "number"),
  environmentOverride(["issues", "validation", "duplicateDetection", "thresholds", "highConfidence"], "number"),
  environmentOverride(["issues", "validation", "duplicateDetection", "thresholds", "reviewMin"], "number"),
  environmentOverride(["issues", "validation", "duplicateDetection", "similarityComment", "enabled"], "boolean"),
  environmentOverride(["issues", "validation", "duplicateDetection", "similarityComment", "commentAnchor"], "string"),
  environmentOverride(["issues", "validation", "duplicateDetection", "similarityComment", "minScore"], "number"),
  environmentOverride(["issues", "validation", "duplicateDetection", "similarityComment", "maxCandidates"], "number"),
  environmentOverride(["issues", "labeling", "enabled"], "boolean"),
  environmentOverride(["issues", "labeling", "autoCreateMissing"], "boolean"),
  environmentOverride(["issues", "labeling", "managed"], "json"),
  environmentOverride(["issues", "labeling", "definitions"], "json"),
  environmentOverride(["issues", "labeling", "keywordRules"], "json"),
  environmentOverride(["issues", "labeling", "aiClassification", "enabled"], "boolean"),
  environmentOverride(["issues", "labeling", "aiClassification", "maxLabels"], "number"),
  environmentOverride(["issues", "labeling", "aiClassification", "minConfidence"], "number"),
  environmentOverride(["issues", "labeling", "aiClassification", "include"], "json"),
  environmentOverride(["issues", "labeling", "aiClassification", "exclude"], "json"),
  environmentOverride(["issues", "labeling", "aiClassification", "prompt"], "string"),
  environmentOverride(["issues", "labeling", "aiClassification", "sourceRepository", "owner"], "string"),
  environmentOverride(["issues", "labeling", "aiClassification", "sourceRepository", "repo"], "string"),
  environmentOverride(["issues", "aiHelp", "enabled"], "boolean"),
  environmentOverride(["issues", "aiHelp", "triggerLabels"], "json"),
  environmentOverride(["issues", "aiHelp", "commentAnchor"], "string"),
  environmentOverride(["issues", "aiHelp", "projectContext", "enabled"], "boolean"),
  environmentOverride(["issues", "aiHelp", "projectContext", "includeRepositoryMetadata"], "boolean"),
  environmentOverride(["issues", "aiHelp", "projectContext", "includeReadme"], "boolean"),
  environmentOverride(["issues", "aiHelp", "projectContext", "readmeMaxChars"], "number"),
  environmentOverride(["issues", "aiHelp", "projectContext", "profile", "name"], "string"),
  environmentOverride(["issues", "aiHelp", "projectContext", "profile", "aliases"], "json"),
  environmentOverride(["issues", "aiHelp", "projectContext", "profile", "summary"], "string"),
  environmentOverride(["issues", "aiHelp", "projectContext", "profile", "techStack"], "json"),
  environmentOverride(["issues", "commands", "enabled"], "boolean"),
  environmentOverride(["issues", "commands", "mentions"], "json"),
  environmentOverride(["issues", "commands", "access"], "string"),
  environmentOverride(["issues", "commands", "fix", "enabled"], "boolean"),
  environmentOverride(["issues", "commands", "fix", "commentAnchor"], "string"),
  environmentOverride(["issues", "commands", "refresh", "enabled"], "boolean"),
  environmentOverride(["pullRequests", "review", "enabled"], "boolean"),
  environmentOverride(["pullRequests", "labeling", "enabled"], "boolean"),
  environmentOverride(["pullRequests", "summary", "enabled"], "boolean")
];

function parseEnvironmentValue(definition: EnvironmentOverrideDefinition): unknown {
  const rawValue = process.env[definition.name];
  const value = rawValue?.trim();
  if (!value) {
    return undefined;
  }

  switch (definition.kind) {
    case "string":
      return value === '""' ? "" : value;
    case "boolean": {
      const normalized = value.toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(normalized)) {
        return false;
      }
      throw new Error(`${definition.name} must be true or false.`);
    }
    case "number": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${definition.name} must be a number.`);
      }
      return parsed;
    }
    case "json":
      try {
        return JSON.parse(value) as unknown;
      } catch (error) {
        throw new Error(`Invalid JSON in ${definition.name}: ${String(error)}`);
      }
  }
}

function setNestedValue(target: Record<string, unknown>, pathSegments: string[], value: unknown): void {
  let current = target;
  for (const segment of pathSegments.slice(0, -1)) {
    const existing = current[segment];
    if (!isObject(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[pathSegments.at(-1)!] = value;
}

function buildConfigEnvironmentOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const definition of repoBotConfigEnvironmentVariables) {
    const value = parseEnvironmentValue(definition);
    if (value !== undefined) {
      setNestedValue(overrides, definition.path, value);
    }
  }
  return overrides;
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base)) {
    return (Array.isArray(override) ? override : base) as T;
  }
  if (isObject(base) && isObject(override)) {
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      const current = result[key];
      if (Array.isArray(current)) {
        result[key] = Array.isArray(value) ? value : current;
        continue;
      }
      if (isObject(current)) {
        result[key] = deepMerge(current, value);
        continue;
      }
      result[key] = value;
    }
    return result as T;
  }
  return (override as T) ?? base;
}

export async function loadRepoBotConfig(params: {
  workspace: string;
  configPath: string;
  overridesJson?: string;
  dryRunInput: boolean;
}): Promise<RepoBotConfig> {
  const filePath = path.join(params.workspace, params.configPath);
  const rawYaml = await readFile(filePath, "utf8");
  const parsedYaml = (yaml.load(rawYaml) ?? {}) as RepoBotConfigInput;

  const inputOverrides = parseJsonOverrides(params.overridesJson, "config-overrides-json");
  const environmentOverrides = parseJsonOverrides(
    process.env.REPO_BOT_CONFIG_OVERRIDES_JSON,
    "REPO_BOT_CONFIG_OVERRIDES_JSON"
  );
  const configEnvironmentOverrides = buildConfigEnvironmentOverrides();

  const mergedInput = deepMerge(parsedYaml, inputOverrides);
  const mergedEnvironment = deepMerge(mergedInput, environmentOverrides);
  const merged = deepMerge(mergedEnvironment, configEnvironmentOverrides);
  const parsed = repoBotConfigSchema.parse(merged);
  parsed.runtime.dryRun = parsed.runtime.dryRun || params.dryRunInput;

  return parsed;
}
