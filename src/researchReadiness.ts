/** A point-in-time diagnostic, not permission to run or proof of a backup. */
export interface ResearchReadiness {
  checkedAt: string;
  workspace: string;
  projectId: string;
  entryId: string;
  notebookId: string;
  paths: { paper: string; data: string; notebook: string };
  revisions: { source: string; conversation: number; notebook: string; workbench: number };
  python: { available: boolean; checkedAt: string; version?: string; packages: Record<string, string | null>; error?: string };
  execution: { targets: ["local"]; maxConcurrentRuns: number; maxConcurrentRunsPerNotebook?: 1; availableRuns?: number; busy: boolean; runBudgetsMs: number[]; remoteEnabled: false };
  warnings: string[];
}
