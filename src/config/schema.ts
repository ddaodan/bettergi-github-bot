import { z } from "zod";

const sectionRuleSchema = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1),
  placeholderHints: z.array(z.string().min(1)).default([])
});

const templateSchema = z.object({
  key: z.string().min(1),
  detect: z.object({
    markers: z.array(z.string().min(1)).default([])
  }),
  requiredSections: z.array(sectionRuleSchema).default([]),
  labels: z.object({
    whenValid: z.array(z.string().min(1)).default([]),
    whenInvalid: z.array(z.string().min(1)).default([])
  })
});

const duplicateDetectionSchema = z.object({
  enabled: z.boolean().default(true),
  bypassLabels: z.array(z.string().min(1)).default(["no-auto-duplicate"]),
  duplicateLabel: z.string().min(1).default("duplicate"),
  searchResultLimit: z.number().int().positive().max(100).default(50),
  candidateLimit: z.number().int().positive().max(50).default(20),
  aiReviewMaxCandidates: z.number().int().positive().max(10).default(3),
  thresholds: z.object({
    exact: z.number().min(0).max(1).default(0.995),
    highConfidence: z.number().min(0).max(1).default(0.93),
    reviewMin: z.number().min(0).max(1).default(0.82)
  }).default(() => ({
    exact: 0.995,
    highConfidence: 0.93,
    reviewMin: 0.82
  }))
});

const keywordRuleSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  labels: z.array(z.string().min(1)).min(1),
  fields: z.array(z.enum(["title", "body", "sections"])).default(["title", "body"]),
  caseSensitive: z.boolean().default(false)
});

const projectProfileSchema = z.object({
  name: z.string().default(""),
  aliases: z.array(z.string().min(1)).default([]),
  summary: z.string().default(""),
  techStack: z.array(z.string().min(1)).default([])
});

const projectContextSchema = z.object({
  enabled: z.boolean().default(true),
  includeRepositoryMetadata: z.boolean().default(true),
  includeReadme: z.boolean().default(true),
  readmeMaxChars: z.number().int().positive().max(20000).default(3000),
  profile: projectProfileSchema.default(() => ({
    name: "",
    aliases: [],
    summary: "",
    techStack: []
  }))
});

export const repoBotConfigSchema = z.object({
  runtime: z.object({
    languageMode: z.enum(["auto", "zh", "zh-en"]).default("auto"),
    dryRun: z.boolean().default(false)
  }).default(() => ({
    languageMode: "auto" as const,
    dryRun: false
  })),
  providers: z.object({
    openAiCompatible: z.object({
      enabled: z.boolean().default(false),
      baseUrl: z.string().default(""),
      model: z.string().default(""),
      apiStyle: z.enum(["auto", "responses", "chat_completions"]).default("auto"),
      timeoutMs: z.number().int().positive().default(30000)
    }).default(() => ({
      enabled: false,
      baseUrl: "",
      model: "",
      apiStyle: "auto" as const,
      timeoutMs: 30000
    }))
  }).default(() => ({
    openAiCompatible: {
      enabled: false,
      baseUrl: "",
      model: "",
      apiStyle: "auto" as const,
      timeoutMs: 30000
    }
  })),
  issues: z.object({
    validation: z.object({
      enabled: z.boolean().default(true),
      fallbackTemplateKey: z.string().optional(),
      commentAnchor: z.string().min(1).default("issue-bot:validation"),
      templates: z.array(templateSchema).default([]),
      duplicateDetection: duplicateDetectionSchema.default(() => ({
        enabled: true,
        bypassLabels: ["no-auto-duplicate"],
        duplicateLabel: "duplicate",
        searchResultLimit: 50,
        candidateLimit: 20,
        aiReviewMaxCandidates: 3,
        thresholds: {
          exact: 0.995,
          highConfidence: 0.93,
          reviewMin: 0.82
        }
      }))
    }).default(() => ({
      enabled: true,
      commentAnchor: "issue-bot:validation",
      templates: [],
      duplicateDetection: {
        enabled: true,
        bypassLabels: ["no-auto-duplicate"],
        duplicateLabel: "duplicate",
        searchResultLimit: 50,
        candidateLimit: 20,
        aiReviewMaxCandidates: 3,
        thresholds: {
          exact: 0.995,
          highConfidence: 0.93,
          reviewMin: 0.82
        }
      }
    })),
    labeling: z.object({
      enabled: z.boolean().default(true),
      autoCreateMissing: z.boolean().default(true),
      managed: z.array(z.string().min(1)).default([]),
      definitions: z.record(z.string().min(1), z.object({
        color: z.string().regex(/^[0-9a-fA-F]{6}$/),
        description: z.string().optional()
      })).default({}),
      keywordRules: z.array(keywordRuleSchema).default([])
    }).default(() => ({
      enabled: true,
      autoCreateMissing: true,
      managed: [],
      definitions: {},
      keywordRules: []
    })),
    aiHelp: z.object({
      enabled: z.boolean().default(false),
      triggerLabels: z.array(z.string().min(1)).default([]),
      commentAnchor: z.string().min(1).default("issue-bot:ai"),
      projectContext: projectContextSchema.default(() => ({
        enabled: true,
        includeRepositoryMetadata: true,
        includeReadme: true,
        readmeMaxChars: 3000,
        profile: {
          name: "",
          aliases: [],
          summary: "",
          techStack: []
        }
      }))
    }).default(() => ({
      enabled: false,
      triggerLabels: [],
      commentAnchor: "issue-bot:ai",
      projectContext: {
        enabled: true,
        includeRepositoryMetadata: true,
        includeReadme: true,
        readmeMaxChars: 3000,
        profile: {
          name: "",
          aliases: [],
          summary: "",
          techStack: []
        }
      }
    }))
  }).default(() => ({
    validation: {
      enabled: true,
      commentAnchor: "issue-bot:validation",
      templates: [],
      duplicateDetection: {
        enabled: true,
        bypassLabels: ["no-auto-duplicate"],
        duplicateLabel: "duplicate",
        searchResultLimit: 50,
        candidateLimit: 20,
        aiReviewMaxCandidates: 3,
        thresholds: {
          exact: 0.995,
          highConfidence: 0.93,
          reviewMin: 0.82
        }
      }
    },
    labeling: {
      enabled: true,
      autoCreateMissing: true,
      managed: [],
      definitions: {},
      keywordRules: []
    },
    aiHelp: {
      enabled: false,
      triggerLabels: [],
      commentAnchor: "issue-bot:ai",
      projectContext: {
        enabled: true,
        includeRepositoryMetadata: true,
        includeReadme: true,
        readmeMaxChars: 3000,
        profile: {
          name: "",
          aliases: [],
          summary: "",
          techStack: []
        }
      }
    }
  })),
  pullRequests: z.object({
    review: z.object({
      enabled: z.boolean().default(false)
    }).default(() => ({
      enabled: false
    })),
    labeling: z.object({
      enabled: z.boolean().default(false)
    }).default(() => ({
      enabled: false
    })),
    summary: z.object({
      enabled: z.boolean().default(false)
    }).default(() => ({
      enabled: false
    }))
  }).default(() => ({
    review: {
      enabled: false
    },
    labeling: {
      enabled: false
    },
    summary: {
      enabled: false
    }
  }))
});

export type RepoBotConfigInput = z.input<typeof repoBotConfigSchema>;
