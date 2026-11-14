import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { checkPlan, testFiles } from "./checkPlan.mjs";

const scripts = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).scripts;
const tests = testFiles(scripts);
test("routine checks stay focused; optional samples rotate without duplication", () => {
  assert.equal(checkPlan({areas:["queue"],tests}).sampled.length,0);
  const first = checkPlan({ areas: ["queue"], tests, sample:true });
  const next = checkPlan({ areas: ["queue"], tests, cursor: first.nextCursor, sample:true });
  assert.equal(first.broad, false);
  assert.deepEqual(first.targeted, ["server/attention.test.ts", "server/projectQueue.test.ts", "server/queueEntries.test.ts"]);
  assert.equal(first.sampled.length, 2);
  assert.equal(new Set(first.files).size, first.files.length);
  assert.notDeepEqual(first.sampled, next.sampled);
  const seen = new Set();
  for (let cursor = 0; cursor < tests.length; cursor++) for (const file of checkPlan({ areas: ["queue"], tests, cursor, sample:true }).sampled) seen.add(file);
  assert.equal(seen.size, tests.length - first.targeted.length);
});
test("sensitive changes require an explicit focused selection rather than an implicit full run", () => {
  for (const area of ["files", "source", "storage", "compiler", "research", "models", "harness"]) {
    assert.throws(()=>checkPlan({areas:[area],tests}),/explicit --test/);
    assert.deepEqual(checkPlan({areas:[area],tests,only:["server/sourceRefresh.test.ts"]}).files,["server/sourceRefresh.test.ts"]);
  }
  for (const file of ["server/projects.ts", "src/App.tsx", "src/state.ts", "package.json", "server/latexPlugin.ts"]) assert.throws(()=>checkPlan({ areas: ["ui"], tests, changed: [file] }),/explicit --test/);
  assert.equal(checkPlan({ areas: ["ui"], tests, changed: ["src/styles.css"] }).broad, false);
  assert.equal(checkPlan({ full: true, tests }).sampled.length, 0);
  assert.deepEqual(checkPlan({full:true,tests}).files,tests);
  assert.deepEqual(checkPlan({only:["server/sourceRefresh.test.ts"],tests}).files,["server/sourceRefresh.test.ts"]);
  assert.throws(()=>checkPlan({full:true,only:["server/sourceRefresh.test.ts"],tests}),/Do not combine/);
});
test("bad scopes and unknown tests cannot produce a false passing plan", () => {
  assert.throws(() => checkPlan({ tests }), /Choose/);
  assert.throws(() => checkPlan({ areas: ["typo"], tests }), /Unknown/);
  assert.throws(() => checkPlan({ areas: ["queue"], tests, changed: ["server/missing.test.ts"] }), /not in package/);
  assert.throws(() => testFiles({ test: "npm run something" }), /Unsupported/);
  assert.equal(checkPlan({ areas: ["ui"], tests, cursor: NaN }).nextCursor, 1);
});
