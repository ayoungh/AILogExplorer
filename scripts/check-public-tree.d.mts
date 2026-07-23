export type PublicTreeFinding = {
  path: string;
  issues: string[];
};

export function pathPolicyIssues(candidatePath: string): string[];
export function contentPolicyIssues(content: string): string[];
export function inspectCandidate(candidatePath: string, content?: string): string[];
export function listCommitCandidates(cwd?: string): string[];
export function checkPublicTree(cwd?: string): {
  candidates: string[];
  findings: PublicTreeFinding[];
};
