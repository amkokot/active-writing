import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkedLocalStudyAnswer, localBudget, localModels, unloadLocalModels, localOnlyModel, localRewriteMessage, localStudyInstructions, localStudySchema, parseLocalCandidates, queueLocalStudy, readLocalJob } from "./localModels.ts";
import { createRuntimeStarter } from "./localRuntime.ts";
import { shieldLatex } from "../src/rewrite.ts";
import { replaceFile } from "./atomicFile.ts";
import { registerProject, parseProject } from "./projects.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import type { NotebookEntry } from "../src/types.ts";

test("overlapping local requests share one probe and one startup", async () => {
  let probes = 0, starts = 0, running = false;
  let release!: () => void;
  const started = new Promise<void>(resolve => { release = resolve; });
  const ensure = createRuntimeStarter({ probe: async () => { probes++; if (!running) throw new Error("offline"); },
    start: async () => { starts++; await started; running = true; } });
  const first = ensure();
  const requests = Array.from({ length: 100 }, () => ensure());
  assert.ok(requests.every(request => request === first));
  await Promise.resolve(); assert.equal(starts, 1); assert.equal(probes, 1);
  release(); await Promise.all(requests);
  await ensure(); assert.equal(starts, 1); assert.equal(probes, 2);
});

test("failed startup backs off and an externally started runtime can recover immediately", async () => {
  let starts = 0, time = 0, running = false;
  const ensure = createRuntimeStarter({ probe: async () => { if (!running) throw new Error("offline"); },
    start: async () => { starts++; throw new Error("startup failed"); }, now: () => time });
  await assert.rejects(ensure(), /startup failed.*paused for 30 seconds/);
  const burst = await Promise.allSettled(Array.from({ length: 50 }, () => ensure()));
  assert.ok(burst.every(result => result.status === "rejected")); assert.equal(starts, 1);
  time = 29_999; await assert.rejects(ensure(), /startup failed/); assert.equal(starts, 1);
  time = 30_000; await assert.rejects(ensure(), /startup failed/); assert.equal(starts, 2);
  running = true; await ensure(); assert.equal(starts, 2);
});

test("opening or refreshing model options and releasing memory never starts an offline runtime", async () => {
  const source = await readFile(path.resolve("server/localModels.ts"), "utf8");
  assert.equal(source.slice(source.indexOf("export async function localModels()"), source.indexOf("async function checkInstalled")).includes("ensureLocalRuntime()"), false);
  assert.match(source, /windowsHide: true, shell: false, detached: false, stdio: "ignore"/);
  const originalFetch = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async url => { calls.push(String(url)); throw new Error("offline"); };
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => localModels()));
    assert.ok(results.every(result => result.runtimeRunning === false && result.models.length === 0));
    assert.match(results[0].note!, /opening this panel does not/);
    assert.deepEqual(await unloadLocalModels(), { success: true });
    assert.ok(calls.every(url => /\/api\/(tags|ps)$/.test(url)));
    assert.equal(calls.length, 11);
  } finally { globalThis.fetch = originalFetch; }
});

test("atomic cache replacement retries transient Windows locks without deleting originals", async () => {
  let attempts = 0;
  const waits: number[] = [];
  await replaceFile("temporary", "original", async () => { if (++attempts < 3) throw Object.assign(new Error("locked"), { code: "EPERM" }); }, async (ms) => { waits.push(ms); });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [40, 80]);
  attempts = 0;
  await assert.rejects(replaceFile("temporary", "original", async () => { attempts++; throw Object.assign(new Error("missing"), { code: "ENOENT" }); }, async () => {}), /missing/);
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(replaceFile("temporary", "original", async () => { attempts++; throw Object.assign(new Error("locked"), { code: "EBUSY" }); }, async () => {}), /locked/);
  assert.equal(attempts, 6);
});

test("local routes reject cloud/remote tags and keep modest bounded effort budgets", () => {
  assert.equal(localOnlyModel("qwen3:4b-instruct"), true);
  for (const name of ["qwen3:cloud", "https://example.com/model", "../model", "", "qwen3:4b\n"]) assert.equal(localOnlyModel(name), false);
  assert.deepEqual([0, 1, 2, 3].map((effort) => localBudget(effort).alternatives), [1, 2, 3, 4]);
  assert.equal(localBudget(999).context, 4096);
  assert.equal(localBudget(0).tokens, 256);
});

test("local learning requests reject oversized context, remote models and invalid output budgets before queueing", async () => {
  const request = { projectId: "test", entryId: "entry", packet: "Explain this approach.", model: "qwen3:4b-instruct", effort: 1 };
  for (const patch of [{ packet: "" }, { packet: "x".repeat(16001) }, { model: "qwen3:cloud" }, { effort: 4 }, { entryId: "" }])
    await assert.rejects(queueLocalStudy(process.cwd(), { ...request, ...patch }), /question under 16,000 characters/);
  await assert.rejects(queueLocalStudy(process.cwd(), { ...request, guidance: "bad" as any }), /question under 16,000 characters/);
});

test("hint mode constrains local output independently of resource budget and explanation depth", () => {
  const schema = localStudySchema("hint");
  assert.deepEqual(schema.properties.argument, { type: "string", const: "" });
  assert.deepEqual(schema.properties.background, { type: "string", const: "" });
  assert.equal(schema.properties.references.maxItems, 0);
  assert.match(localStudyInstructions({ effort: 3, guidance: "hint" }), /Do not solve the proof/);
  assert.match(localStudyInstructions({ effort: 1, guidance: "outline" }), /leaving decisive derivations/);
  assert.deepEqual(localStudySchema("walkthrough").properties.argument, { type: "string" });
});

test("format-only local replies are rejected without claiming semantic verification", () => {
  const reply = { idea: "Mechanism and target", background: "", argument: "", checks: "Hypotheses, uncertainties and a useful next check", references: [] };
  assert.throws(() => checkedLocalStudyAnswer(JSON.stringify(reply), "hint"), /form labels/);
  const specific = { ...reply, idea: "Unroll the contraction recurrence before choosing batch sizes.", checks: "What exponent is left after dividing by the batch allocation?" };
  assert.deepEqual(checkedLocalStudyAnswer(JSON.stringify(specific), "hint"), specific);
  assert.throws(() => checkedLocalStudyAnswer(JSON.stringify({ ...specific, argument: "Full solution." }), "hint"), /gave more than a hint/);
  // A plausible but wrong mathematical answer must not be labelled correct by this format check.
  assert.equal(checkedLocalStudyAnswer(JSON.stringify({ ...specific, idea: "All contractions reach their fixed point in one iteration." }), "hint").idea, "All contractions reach their fixed point in one iteration.");
});

test("local prompts separate the selection from optional context and mask all protected syntax", () => {
  const input = { sourceText: "A bound on $x  y$.", context: "A bound on $x  y$.", instruction: "Shorten", model: "qwen3:4b-instruct", effort: 1, projectId: "test", sessionId: "session" };
  assert.equal(localRewriteMessage(input).surroundingParagraphForContextOnly, undefined);
  const message = localRewriteMessage({ ...input, context: `Before $a$. ${input.sourceText} After \\ref{b}.` });
  assert.deepEqual(message.immutableTokens, ["ZZPFPROTECTED0ZZ"]);
  assert.equal(message.selectedText, "A bound on ZZPFPROTECTED0ZZ.");
  assert.equal(message.surroundingParagraphForContextOnly, "Before [immutable LaTeX]. [selected passage] After [immutable LaTeX].");
});

test("local candidates restore exact math/commands/comments and withhold missing, repeated or reordered markers", () => {
  const source = "In order to retain $x  + y$, see \\ref{thm:a}.\n% keep this comment\n";
  const masked = shieldLatex(source);
  const good = masked.safe.replace("In order to", "To");
  const missing = good.replace(masked.markers[0], "");
  const repeated = good + masked.markers[0];
  const swapped = good.replace(masked.markers[0], "SWAP").replace(masked.markers[1], masked.markers[0]).replace("SWAP", masked.markers[1]);
  const result = parseLocalCandidates(source, JSON.stringify({ alternatives: [good, missing, repeated, swapped] }));
  assert.deepEqual(result.candidates, [source.replace("In order to", "To")]);
  assert.equal(result.rejected, 3);
});

test("literal marker collisions stay author text, duplicate/no-op candidates do not accumulate", () => {
  const source = "In order to keep ZZPFPROTECTED0ZZ and $a  b$ exact.";
  const good = shieldLatex(source).safe.replace("In order to", "To");
  assert.deepEqual(parseLocalCandidates(source, JSON.stringify({ alternatives: [good, good, shieldLatex(source).safe] })).candidates, [source.replace("In order to", "To")]);
  assert.throws(() => parseLocalCandidates(source, "not JSON"));
});

test("local result IDs cannot escape the app's job directory", async () => {
  const root = await mkdtemp(path.join(process.cwd(), ".paperfocus", "trials", "local-model-test-"));
  await assert.rejects(readLocalJob(root, "../../source", "test"), /Invalid local task/);
});

test("queued studies cache ordinary requests, fresh passes rerun, failed reviews preserve drafts, and privacy gates hold", async () => {
  const root = await mkdtemp(path.join(process.cwd(), ".paperfocus", "trials", "local-iteration-test-"));
  await mkdir(path.join(root, "paper"));
  const source = "\\documentclass{article}\n\\begin{document}\n\\section{Result}\nAssume a fixed point exists and q is strictly less than one.\n\\end{document}";
  await writeFile(path.join(root, "paper", "main.tex"), source);
  const project = await registerProject(root, "paper", "Iteration fixture"), doc = await parseProject(root, project.id);
  const entry: NotebookEntry = { id: "entry", title: "Check", question: "Check the bound", notes: "", reply: "", proposal: "", route: "local", effort: 1, status: "open", handoffs: [], appliedChanges: [], createdAt: "now", updatedAt: "now", study: { mode: "understand", depth: "intuition", action: "explain", background: "", localEffort: 1, turns: [] } };
  let saved = await writeNotebook(root, project.id, 0, [entry]);
  const originalFetch = globalThis.fetch; let generations = 0, reviews = 0;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:11435\/api\//);
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    let value: unknown = {};
    if (String(url).endsWith("/tags")) value = { models: [{ name: "test-local", size: 1 }] };
    if (String(url).endsWith("/chat")) {
      if (body.tools) { reviews++; value = { message: { tool_calls: [{ function: { name: "shell", arguments: {} } }] } }; }
      else { generations++; value = { message: { content: JSON.stringify({ idea: `Conditional residual deduction ${generations}`, background: "", argument: "Divide only when 1-q is positive.", checks: "Confirm the strict inequality.", references: [] }) } }; }
    }
    return new Response(JSON.stringify(value), { status: 200 });
  };
  async function finish(id: string) {
    for (let i = 0; i < 100; i++) { const job = await readLocalJob(root, id, project.id); if (job.status === "ready" || job.status === "failed") return job; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error("Mocked queue did not finish");
  }
  try {
    const input = { projectId: project.id, entryId: entry.id, packet: "Explain this conditional estimate.", model: "test-local", effort: 1 };
    const first = await finish((await queueLocalStudy(root, input)).id); assert.equal(first.status, "ready");
    const cached = await queueLocalStudy(root, input); assert.equal(cached.id, first.id); assert.equal(cached.cached, true); assert.equal(generations, 1);
    const fresh = await finish((await queueLocalStudy(root, { ...input, fresh: "explicit-click-1" })).id);
    assert.notEqual(fresh.id, first.id); assert.equal(generations, 2);
    assert.equal((await queueLocalStudy(root, { ...input, fresh: "explicit-click-1" })).cached, true, "retrying one click is idempotent");
    const reviewed = await finish((await queueLocalStudy(root, { ...input, secondLook: true, sourceRevision: doc.revision })).id);
    assert.equal(reviewed.status, "ready"); assert.equal(reviewed.secondLook?.status, "failed"); assert.match(reviewed.studyReply!, /Conditional residual/);
    assert.equal(reviews, 1); assert.equal(generations, 3);
    for (const fresh of ["../escape", "", 3]) await assert.rejects(queueLocalStudy(root, { ...input, fresh: fresh as any }), /fresh pass/);
    await assert.rejects(queueLocalStudy(root, { ...input, secondLook: true, guidance: "hint" }), /off for Tiny, hints/);
    await assert.rejects(queueLocalStudy(root, { ...input, secondLook: true, sourceRevision: "old" }), /paper changed/);
    entry.study!.benchmark = { statement: "A statement", phase: "attempt", citationKey: "", locator: "", referenceNotes: "hidden proof" };
    saved = await writeNotebook(root, project.id, saved.revision, [entry]);
    await assert.rejects(queueLocalStudy(root, { ...input, secondLook: true }), /statement-only/);
    assert.equal(generations, 3); assert.equal((await readNotebook(root, project.id)).revision, saved.revision);
    assert.equal(await readFile(path.join(root, "paper", "main.tex"), "utf8"), source);
  } finally { globalThis.fetch = originalFetch; }
});
