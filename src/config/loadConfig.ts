import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import type { RepoBotConfig } from "../core/types.js";
import { repoBotConfigSchema, type RepoBotConfigInput } from "./schema.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  const overrides = params.overridesJson?.trim()
    ? (JSON.parse(params.overridesJson) as RepoBotConfigInput)
    : {};

  const merged = deepMerge(parsedYaml, overrides);
  const parsed = repoBotConfigSchema.parse(merged);
  parsed.runtime.dryRun = parsed.runtime.dryRun || params.dryRunInput;

  return parsed;
}
