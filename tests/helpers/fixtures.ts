import type {
  DuplicateCandidate,
  IssueCommentContext,
  IssueContext,
  LabelDefinition,
  RepoBotConfig,
  RepositoryMetadata
} from "../../src/core/types.js";
import type { CommentRecord, GitHubGateway, SearchIssueParams } from "../../src/github/gateway.js";

export function createConfig(): RepoBotConfig {
  const definitions: Record<string, LabelDefinition> = {
    "BUG": { color: "d73a4a", description: "缺陷反馈。" },
    "需要更多信息": { color: "fbca04", description: "需要补充必要信息。" },
    "需要 AI 分析": { color: "0e8a16", description: "满足 AI 分析条件。" },
    "重复": { color: "cfd3d7", description: "重复问题。" }
  };

  return {
    runtime: {
      languageMode: "auto",
      dryRun: false
    },
    providers: {
      openAiCompatible: {
        enabled: false,
        baseUrl: "",
        model: "",
        apiStyle: "auto",
        timeoutMs: 30000
      }
    },
    issues: {
      autoProcessing: {
        skipCreatedBefore: ""
      },
      validation: {
        enabled: true,
        fallbackTemplateKey: "bug",
        commentAnchor: "issue-bot:validation",
        templates: [
          {
            key: "bug",
            detect: {
              markers: ["bug"],
              titlePrefixes: ["[bug]"]
            },
            requiredSections: [
              { id: "environment", aliases: ["Environment"] },
              { id: "steps", aliases: ["Steps to Reproduce"] },
              { id: "expected", aliases: ["Expected Behavior"] }
            ],
            labels: {
              whenValid: ["BUG"],
              whenInvalid: ["需要更多信息"]
            }
          }
        ],
        duplicateDetection: {
          enabled: true,
          bypassLabels: ["跳过重复检测"],
          duplicateLabel: "重复",
          searchResultLimit: 50,
          candidateLimit: 20,
          aiReviewMaxCandidates: 3,
          thresholds: {
            exact: 0.995,
            highConfidence: 0.93,
            reviewMin: 0.82
          },
          similarityComment: {
            enabled: true,
            commentAnchor: "issue-bot:similar-issues",
            minScore: 0.3,
            maxCandidates: 3
          }
        }
      },
      labeling: {
        enabled: true,
        autoCreateMissing: true,
        managed: ["BUG", "需要更多信息", "需要 AI 分析", "重复"],
        definitions,
        keywordRules: [
          {
            keywords: ["crash"],
            labels: ["需要 AI 分析"],
            fields: ["title", "body"],
            caseSensitive: false
          }
        ],
        aiClassification: {
          enabled: false,
          maxLabels: 3,
          minConfidence: 0.65,
          include: [],
          exclude: [],
          prompt: "",
          sourceRepository: {
            owner: "",
            repo: ""
          }
        }
      },
      aiHelp: {
        enabled: false,
        triggerLabels: ["需要 AI 分析"],
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
      },
      commands: {
        enabled: false,
        mentions: ["@bot"],
        access: "collaborators",
        fix: {
          enabled: false,
          commentAnchor: "issue-bot:fix"
        },
        refresh: {
          enabled: false
        }
      }
    },
    pullRequests: {
      review: { enabled: false },
      labeling: { enabled: false },
      summary: { enabled: false }
    }
  };
}

export function createIssue(overrides: Partial<IssueContext> = {}): IssueContext {
  return {
    kind: "issue",
    owner: "octo",
    repo: "repo",
    number: 1,
    title: "Plugin crashes after startup",
    body: [
      "<!-- issue-template: bug -->",
      "",
      "## Environment",
      "Windows 11 / Java 21",
      "",
      "## Steps to Reproduce",
      "1. Start the plugin",
      "2. Wait for the crash",
      "",
      "## Expected Behavior",
      "The plugin should keep running"
    ].join("\n"),
    state: "open",
    labels: [],
    htmlUrl: "https://example.test/issues/1",
    createdAt: "2026-04-02T00:00:00Z",
    updatedAt: "2026-04-02T00:00:00Z",
    action: "opened",
    ...overrides
  };
}

export function createIssueCommentContext(overrides: Partial<IssueCommentContext> = {}): IssueCommentContext {
  const issue = createIssue();
  const base: IssueCommentContext = {
    issue,
    commentId: 100,
    commentBody: "@bot /refresh",
    commentAuthorLogin: "octocat",
    commentAuthorType: "User",
    commentAuthorAssociation: "COLLABORATOR",
    action: "created"
  };

  return {
    ...base,
    ...overrides,
    issue: overrides.issue ?? issue
  };
}

export class FakeGateway implements GitHubGateway {
  public readonly comments: Array<{ issueNumber: number; body: string; id: number }> = [];

  public readonly createdLabels = new Set<string>();

  public readonly deletedCommentIds: number[] = [];

  public readonly removedLabels: string[] = [];

  public readonly closedIssues: number[] = [];

  public readonly searchRequests: SearchIssueParams[] = [];

  public readonly commentReactions: Array<{ commentId: number; reaction: "eyes" | "rocket" | "confused" }> = [];

  public readonly repositoryVariables = new Map<string, string>();

  private commentId = 1;

  public constructor(
    public issue: IssueContext,
    private readonly searchResults: DuplicateCandidate[] = [],
    private readonly repositoryMetadata: RepositoryMetadata = {
      owner: issue.owner,
      repo: issue.repo,
      fullName: `${issue.owner}/${issue.repo}`,
      description: "Example repository description.",
      topics: ["automation", "desktop"],
      homepage: "https://example.test"
    },
    private readonly repositoryReadme = "# Example Repo\n\nThis repository automates desktop tasks.",
    private readonly issueComment?: IssueCommentContext,
    private readonly repositoryLabelsByRepo: Record<string, Record<string, LabelDefinition>> = {}
  ) {}

  public async getIssueContext(): Promise<IssueContext | undefined> {
    return this.issue;
  }

  public async getIssueCommentContext(): Promise<IssueCommentContext | undefined> {
    return this.issueComment;
  }

  public async getRepositoryVariable(name: string): Promise<string | undefined> {
    return this.repositoryVariables.get(name);
  }

  public async upsertRepositoryVariable(name: string, value: string): Promise<void> {
    this.repositoryVariables.set(name, value);
  }

  public async getRepositoryMetadata(): Promise<RepositoryMetadata> {
    return this.repositoryMetadata;
  }

  public async getRepositoryReadme(): Promise<string | undefined> {
    return this.repositoryReadme;
  }

  public async getRepositoryLabels(params?: { owner?: string; repo?: string }): Promise<Record<string, LabelDefinition>> {
    const owner = params?.owner ?? this.issue.owner;
    const repo = params?.repo ?? this.issue.repo;
    return this.repositoryLabelsByRepo[`${owner}/${repo}`] ?? {};
  }

  public async listComments(issueNumber: number): Promise<CommentRecord[]> {
    return this.comments.filter((comment) => comment.issueNumber === issueNumber);
  }

  public async createComment(issueNumber: number, body: string): Promise<void> {
    this.comments.push({
      issueNumber,
      body,
      id: this.commentId++
    });
  }

  public async updateComment(commentId: number, body: string): Promise<void> {
    const existing = this.comments.find((comment) => comment.id === commentId);
    if (existing) {
      existing.body = body;
    }
  }

  public async deleteComment(commentId: number): Promise<void> {
    const index = this.comments.findIndex((comment) => comment.id === commentId);
    if (index >= 0) {
      this.comments.splice(index, 1);
      this.deletedCommentIds.push(commentId);
    }
  }

  public async addIssueCommentReaction(commentId: number, reaction: "eyes" | "rocket" | "confused"): Promise<void> {
    this.commentReactions.push({ commentId, reaction });
  }

  public async addLabels(issueNumber: number, labels: string[]): Promise<void> {
    if (issueNumber !== this.issue.number) {
      return;
    }
    for (const label of labels) {
      if (!this.issue.labels.includes(label)) {
        this.issue.labels.push(label);
      }
    }
  }

  public async removeLabel(issueNumber: number, label: string): Promise<void> {
    if (issueNumber !== this.issue.number) {
      return;
    }
    this.issue.labels = this.issue.labels.filter((item) => item !== label);
    this.removedLabels.push(label);
  }

  public async ensureLabels(definitions: Record<string, LabelDefinition>, labels: string[]): Promise<void> {
    for (const label of labels) {
      if (definitions[label]) {
        this.createdLabels.add(label);
      }
    }
  }

  public async closeIssue(issueNumber: number): Promise<void> {
    this.closedIssues.push(issueNumber);
    this.issue.state = "closed";
  }

  public async searchIssues(params: SearchIssueParams): Promise<DuplicateCandidate[]> {
    this.searchRequests.push(params);
    return this.searchResults;
  }
}
