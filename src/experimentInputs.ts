/** Declared files only: not automatic dependency discovery or a security sandbox. */
export interface ExperimentInput { root: "paper" | "data"; path: string }
export interface CapturedExperimentInput extends ExperimentInput { sha256: string; bytes: number }
export function validateExperimentInputs(value: unknown): asserts value is ExperimentInput[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("Declare at most 32 experiment input files.");
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || !["paper", "data"].includes(item.root) || typeof item.path !== "string" || item.path.length > 500 || /[\\:\u0000-\u001f]/.test(item.path)
      || item.path.split("/").some((part: string) => !part || part === "." || part === "..") || seen.has(`${item.root}:${item.path}`)) throw new Error("Use unique relative input paths under paper or data, with forward slashes and no traversal.");
    seen.add(`${item.root}:${item.path}`);
  }
}
export function validateCapturedInputs(value: unknown): asserts value is CapturedExperimentInput[] {
  validateExperimentInputs(value);
  if (value.some(item => !/^[a-f0-9]{64}$/.test((item as CapturedExperimentInput).sha256) || !Number.isSafeInteger((item as CapturedExperimentInput).bytes) || (item as CapturedExperimentInput).bytes < 0 || (item as CapturedExperimentInput).bytes > 20_000_000)) throw new Error("Invalid captured experiment inputs.");
}
