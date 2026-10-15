import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { checkPlan, testFiles } from "./checkPlan.mjs";

const scripts = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).scripts;
const tests = testFiles(scripts);
test("routine checks always include the feature and rotate two other files without duplication", () => {
  const first = checkPlan({ areas: ["queue"], tests });
  const next = checkPlan({ areas: ["queue"], tests, cursor: first.nextCursor });
  assert.equal(first.broad, false);
  assert.deepEqual(first.targeted, ["server/attention.test.ts", "server/projectQueue.test.ts", "server/queueEntries.test.ts"]);
  assert.equal(first.sampled.length, 2);
  assert.equal(new Set(first.files).size, first.files.length);
  assert.notDeepEqual(first.sampled, next.sampled);
  const seen = new Set();
  for (let cursor = 0; cursor < tests.length; cursor++) for (const file of checkPlan({ areas: ["queue"], tests, cursor }).sampled) seen.add(file);
  assert.equal(seen.size, tests.length - first.targeted.length);
});
test("file, save, storage, compiler, harness and unclassified code changes get full coverage", () => {
  for (const area of ["files", "source", "storage", "compiler", "research", "models", "harness"]) assert.deepEqual(checkPlan({ areas: [area], tests }).files, tests);
  for (const file of ["server/projects.ts", "src/App.tsx", "src/state.ts", "package.json", "server/latexPlugin.ts"]) assert.equal(checkPlan({ areas: ["ui"], tests, changed: [file] }).broad, true);
  assert.equal(checkPlan({ areas: ["ui"], tests, changed: ["src/styles.css"] }).broad, false);
  assert.equal(checkPlan({ full: true, tests }).sampled.length, 0);
});
test("bad scopes and unknown tests cannot produce a false passing plan", () => {
  assert.throws(() => checkPlan({ tests }), /Choose/);
  assert.throws(() => checkPlan({ areas: ["typo"], tests }), /Unknown/);
  assert.throws(() => checkPlan({ areas: ["queue"], tests, changed: ["server/missing.test.ts"] }), /not in package/);
  assert.throws(() => testFiles({ test: "npm run something" }), /Unsupported/);
  assert.equal(checkPlan({ areas: ["ui"], tests, cursor: NaN }).nextCursor, 1);
});
