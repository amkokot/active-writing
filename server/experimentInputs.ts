import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { validateExperimentInputs, validateCapturedInputs } from "../src/experimentInputs.ts";
import type { ExperimentInput, CapturedExperimentInput } from "../src/experimentInputs.ts";

export interface InputRoots { paper: string; data: string }
async function inputBytes(roots: InputRoots, input: ExperimentInput, remaining = 20_000_000) {
  const root = path.resolve(roots[input.root]);
  const equal = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!equal(await realpath(root), root)) throw new Error("Experiment input root is redirected.");
  let current = root;
  for (const part of input.path.split("/")) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Experiment inputs cannot use linked paths.");
  }
  const info = await lstat(current);
  if (!info.isFile() || info.size > Math.min(20_000_000, remaining)) throw new Error("Use a regular input file within the 20 MB/file and 50 MB/check limits.");
  const bytes = await readFile(current);
  if (bytes.length > Math.min(20_000_000, remaining)) throw new Error("Experiment input grew beyond its size limit.");
  return bytes;
}
export async function captureExperimentInputs(roots: InputRoots, inputs: ExperimentInput[]) {
  validateExperimentInputs(inputs);
  const result: CapturedExperimentInput[] = [];
  let total = 0;
  for (const input of inputs) {
    const bytes = await inputBytes(roots, input, 50_000_000 - total); total += bytes.length;
    if (total > 50_000_000) throw new Error("Declared experiment inputs exceed 50 MB in total.");
    result.push({ root: input.root, path: input.path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return result;
}
export interface InputCheckCache { hashes: Map<string, { sha256: string; bytes: number }>; totalBytes: number }
export async function checkExperimentInputs(roots: InputRoots, inputs: CapturedExperimentInput[], cache?: InputCheckCache) {
  validateCapturedInputs(inputs);
  const changed: Array<{ root: string; path: string; reason: string }> = [];
  let total = 0;
  for (const input of inputs) {
    try {
      const key = `${path.resolve(roots[input.root])}:${input.path}`;
      let actual = cache?.hashes.get(key);
      if (!actual) {
        if (cache && cache.totalBytes >= 50_000_000) throw new Error("Inspection input budget exhausted; inspect this cell separately.");
        const bytes = await inputBytes(roots, input, Math.min(50_000_000 - total, 50_000_000 - (cache?.totalBytes ?? 0)));
        actual = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
        if (cache) { cache.totalBytes += bytes.length; cache.hashes.set(key, actual); }
      }
      total += actual.bytes;
      if (total > 50_000_000) throw new Error("Input check exceeds 50 MB in total.");
      if (actual.sha256 !== input.sha256) changed.push({ root: input.root, path: input.path, reason: "file changed since execution" });
    } catch (error) { changed.push({ root: input.root, path: input.path, reason: (error as Error).message }); }
  }
  return { checked: inputs.length, changed, note: "Checks declared saved inputs only; matching hashes do not verify a result or freeze files during execution." };
}
