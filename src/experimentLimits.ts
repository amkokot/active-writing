/** Default stays short; larger budgets require an explicit per-run choice. */
export const experimentRunBudgets = [30_000, 120_000, 300_000] as const;
/** Service-wide bound; notebooks remain sequential even in fresh-process mode. */
export function experimentConcurrencyLimit(value: string | undefined): number {
  if (value === undefined) return 2;
  if (!/^[1-4]$/.test(value)) throw new Error("AW_PYTHON_CONCURRENCY must be an integer from 1 to 4.");
  return Number(value);
}
export function experimentRunBudget(value: unknown = 30_000): number {
  if (typeof value !== "number" || !(experimentRunBudgets as readonly number[]).includes(value)) throw new Error("Choose a Python run limit of 30 seconds, 2 minutes or 5 minutes.");
  return value;
}
export const experimentBudgetLabel = (ms: number) => ms < 60_000 ? `${ms / 1000} seconds` : `${ms / 60_000} minutes`;
export const experimentDuration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
/** An already-open older service must not silently ignore a larger requested budget. */
export function checkExperimentBudgetRuntime(runtime: { runBudgetsMs?: number[] } | undefined, requested: number) {
  experimentRunBudget(requested);
  if (requested !== 30_000 && !runtime?.runBudgetsMs?.includes(requested)) throw new Error("The running Aw service needs restarting before it can accept longer Python run limits. No run started.");
}
