import type {
  DuplicateCandidate,
  IssueContext,
  IssueWorkflowTrigger,
  SubIssueProcessingMode,
  ValidationConfig,
  ValidationOutcome
} from "../../core/types.js";
import { isSameRepository, parseGitHubIssueUrl } from "../../github/issueRelations.js";
import { detectTemplate, parseIssueBody } from "./parser.js";

export function resolveSubIssueProcessingMode(params: {
  issue: IssueContext;
  trigger: IssueWorkflowTrigger;
  configuredMode: SubIssueProcessingMode;
}): SubIssueProcessingMode {
  if (!params.issue.isSubIssue) {
    return "normal";
  }

  if (params.configuredMode === "skip" && params.trigger === "command_refresh") {
    return "relaxed";
  }

  return params.configuredMode;
}

export function createRelaxedSubIssueValidation(params: {
  title: string;
  body: string;
  config: ValidationConfig;
}): ValidationOutcome {
  const parsed = parseIssueBody(params.body);
  if (!params.config.enabled) {
    return {
      executed: false,
      valid: true,
      parsed,
      missingSections: [],
      desiredLabels: [],
      invalidLabels: []
    };
  }

  const template = detectTemplate(
    parsed,
    params.config.templates,
    params.title
  );

  return {
    executed: false,
    valid: true,
    template,
    parsed,
    missingSections: [],
    desiredLabels: template?.labels.whenValid ?? [],
    invalidLabels: []
  };
}

export function isDirectIssueRelation(issue: IssueContext, candidate: DuplicateCandidate): boolean {
  const parent = issue.parentIssue
    ? {
      owner: issue.parentIssue.owner,
      repo: issue.parentIssue.repo,
      number: issue.parentIssue.number
    }
    : parseGitHubIssueUrl(issue.parentIssueUrl);

  if (
    parent
    && parent.number === candidate.number
    && parent.owner.toLowerCase() === issue.owner.toLowerCase()
    && parent.repo.toLowerCase() === issue.repo.toLowerCase()
  ) {
    return true;
  }

  const candidateParent = parseGitHubIssueUrl(candidate.parentIssueUrl);
  return Boolean(
    candidateParent
    && candidateParent.number === issue.number
    && isSameRepository(candidateParent, issue.owner, issue.repo)
  );
}
