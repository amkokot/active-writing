import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { applyWindowRequest, compactBrowserExperimentRecoveries, compactSavedExperimentRecoveries, createWindowStateCache, experimentRecoverySnapshot, listWindowRecoveries, readWindowRequest, resetCompanionSession, windowWorkspaceUrl } from "../src/windowWorkspace.ts";
import { validWindowMessage } from "../src/windowMessages.ts";
import type { AppState, ProjectDocument } from "../src/types.ts";
import { freshTurbo } from "../src/turbo.ts";
import { automaticSourceRefresh } from "../src/sourceRefresh.ts";
import { lastProjectKey, parseWorkspaceResume, rememberProject, resumeKey, sessionProjectKey, startupProject } from "../src/workspaceResume.ts";
import { compiledPdfResume, parseReadingPosition } from "../src/readingPosition.ts";
import { manuscriptView, parseManuscriptView, restoreManuscriptView } from "../src/manuscripts.ts";
import { experimentCellUrl, latexEvidenceLink, workspaceBackLink } from "../src/researchLinks.ts";
import { locateSavedPassage } from "../src/sourceRefresh.ts";
import { browserRecoveryFailure, saveBrowserRecovery } from "../src/browserRecovery.ts";
import { ManuscriptBuildCache, manuscriptBuildScope, matchingManuscriptBuild } from "../src/manuscriptBuildCache.ts";
import { locateSourcePassage, manuscriptScope } from "../src/manuscriptView.ts";
import { emptyWorkbench, receiveWorkbench, workbenchSync } from "../src/workbench.ts";
import { latexPlugin } from "./latexPlugin.ts";
import { packBrowserRecovery, unpackBrowserRecovery, packInactiveBrowserRecoveries, automaticLinkedManuscript } from "../src/windowWorkspace.ts";
import { createLargerRecoveryStorage, type RecoveryRecord, type RecoveryStatus } from "../src/largerBrowserRecovery.ts";
import { parseProject, publicDocument, registerProject, saveEdits } from "./projects.ts";

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(i: number) { return [...this.values.keys()][i] ?? null; }
}
test("larger shared recovery bypasses a full legacy cache, retaining old copies and tab-local writes", async () => {
  const legacy = new MemoryStorage(), session = new MemoryStorage(), disk = new Map<string, string | null>();
  legacy.setItem("paperfocus.prototype.v1.old.window.old", "old draft");
  legacy.setItem = () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); };
  const mirror = createLargerRecoveryStorage(legacy, [], async records => { for (const r of records) disk.set(r.key, r.value); }, () => {});
  const cache = createWindowStateCache(mirror.storage, session, "new-window");
  const key = "paperfocus.prototype.v1.new";
  cache.writeSnapshot(key, JSON.stringify({ draft: "new draft" }), "{}");
  assert.equal(JSON.parse(cache.read(key)!).draft, "new draft");
  assert.ok(session.getItem(`${key}.window`), "Immediate per-tab copy exists before the shared commit.");
  await mirror.flush();
  assert.equal(disk.get(`${key}.window.new-window`), JSON.stringify({ draft: "new draft" }));
  assert.equal(legacy.getItem("paperfocus.prototype.v1.old.window.old"), "old draft");
});
test("failed larger-recovery transactions retain newer pending edits and retry honestly", async () => {
  const legacy = new MemoryStorage(), states: RecoveryStatus[] = [], batches: RecoveryRecord[][] = [];
  let reject: (error: Error) => void = () => {};
  const mirror = createLargerRecoveryStorage(legacy, [], records => { batches.push(records); return batches.length === 1 ? new Promise((_resolve, fail) => { reject = fail; }) : Promise.resolve(); }, s => states.push(s));
  const key = "paperfocus.prototype.v1.test";
  mirror.storage.setItem(key, "first"); const failed = mirror.flush();
  mirror.storage.setItem(key, "newer"); mirror.receive([{ key, value: "foreign" }]);
  reject(new Error("Quota exceeded")); await assert.rejects(failed, /Quota exceeded/);
  assert.equal(mirror.storage.getItem(key), "newer");
  assert.match(states.at(-1)!.error!, /could not be saved/);
  await mirror.flush(); assert.deepEqual(batches[1], [{ key, value: "newer" }]);
  assert.equal(states.at(-1)!.error, undefined);
});
test("larger recovery preserves tombstones and cross-window leases without editing unknown data", async () => {
  const legacy = new MemoryStorage(), key = "active-writing.command.test";
  legacy.setItem(key, "obsolete draft"); legacy.setItem("active-writing.window.old.alive", "200");
  const mirror = createLargerRecoveryStorage(legacy, [{ key, value: null }, { key: "active-writing.window.old.alive", value: "100" }], async () => {}, () => {});
  assert.equal(mirror.storage.getItem(key), null);
  assert.equal(mirror.storage.getItem("active-writing.window.old.alive"), "200");
  mirror.receive([{ key, value: "updated" }]); assert.equal(mirror.storage.getItem(key), "updated");
  mirror.storage.removeItem(key); await mirror.flush(); assert.equal(mirror.storage.getItem(key), null);
  assert.equal(legacy.getItem(key), "obsolete draft");
  assert.throws(() => mirror.storage.setItem("other-app-data", "no"), /Unknown/);
});

test("recovery packing is lossless for Unicode, dictionaries at capacity and old raw records", () => {
  let seed = 137;
  const noise = Array.from({ length: 250000 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return String.fromCharCode(seed >>> 16); }).join("");
  const examples = ["", "Existing raw recovery", "abc".repeat(90000),
    JSON.stringify({ draft: "Human math αβγ 😀\u0000\ud800\udfff \\frac{a}{b}\n".repeat(10000), fields: [null, false, 13] }),
    noise, noise + noise, "\u0001AWLZW1: is authored text inside JSON" ];
  for (const value of examples) {
    const packed = packBrowserRecovery(value);
    if (value.startsWith("\u0001AWLZW1:")) continue; // Not a valid JSON recovery snapshot.
    assert.ok(packed.length <= value.length);
    assert.equal(unpackBrowserRecovery(packed), value);
  }
  assert.throws(() => unpackBrowserRecovery("\u0001AWLZW1:x"), /Invalid/);
  assert.throws(() => unpackBrowserRecovery("\u0001AWLZW1:\u0002\u0000"), /Invalid/);
});

test("packed recovery fits a full-cache regression while retaining exact drafts and unrelated windows", () => {
  const local = new MemoryStorage(), session = new MemoryStorage();
  const human: AppState = { ...state(), paragraphEdits: { p: "Unsubmitted human draft 😀".repeat(12000) },
    notebookEntries: [{ id: "human-note", title: "Human note", question: "Keep this", notes: "Keep all fields", reply: "", proposal: "", status: "open", route: "codex", effort: 1, handoffs: [], appliedChanges: [], createdAt: "2026-10-13", updatedAt: "2026-10-13" }], handoffDrafts: { request: { effort: 1, scope: "none", includeProject: false, instruction: "Pending reply" } } };
  const text = JSON.stringify(human), other = JSON.stringify({ paragraphEdits: { other: "Other agent's draft" } });
  local.setItem("paper.window.other-agent", other);
  local.setItem("active-writing.window.other-agent.alive", "1000");
  const baseline = [...local.values.values()].reduce((sum, value) => sum + value.length, 0);
  const set = local.setItem.bind(local), budget = baseline + packBrowserRecovery(text).length + 5000;
  local.setItem = (key, value) => {
    const total = [...local.values.values()].reduce((sum, entry) => sum + entry.length, 0);
    if (total - (local.getItem(key)?.length ?? 0) + value.length > budget) throw { name: "QuotaExceededError" };
    set(key, value);
  };
  assert.throws(() => local.setItem("unpacked", text));
  const cache = createWindowStateCache(local, session, "ours", () => 1000);
  cache.write("paper", human, text);
  assert.equal(cache.read("paper"), text);
  assert.equal(unpackBrowserRecovery(local.getItem("paper.window.ours")!), text);
  assert.equal(local.getItem("paper.window.other-agent"), other);
  assert.equal(local.getItem("active-writing.window.other-agent.alive"), "1000");
  assert.deepEqual(JSON.parse(local.getItem("paper")!).paragraphEdits, {});
  cache.release();
  const reopened = createWindowStateCache(local, new MemoryStorage(), "reopened", () => 1001);
  assert.equal(reopened.read("paper"), text);
  assert.equal(reopened.read("paper", true, "ours"), text);
  assert.equal(listWindowRecoveries(local, "paper", "reopened").find(item => item.id === "ours")?.draftCount, 1);
});

test("quota diagnostics name the failing storage without exposing draft content", () => {
  const local = new MemoryStorage(), session = new MemoryStorage();
  local.setItem = () => { throw { name: "QuotaExceededError" }; };
  const cache = createWindowStateCache(local, session, "ours");
  const notice = saveBrowserRecovery(() => cache.writeSnapshot("key", "Secret human text", "{}"), () => {});
  assert.match(notice!, /shared browser cache; 1 KB write/);
  assert.doesNotMatch(notice!, /Secret human text|key/);
});

test("manuscript PDF cache separates roots and engines, rejects stale sources and keeps immutable focus artifacts", () => {
  const cache = new ManuscriptBuildCache(), a = { ...document(), revision: "saved-a" },
    b = { ...document(), revision: "saved-b", project: { ...document().project, mainFile: "notes.tex" } };
  const result = (doc: ProjectDocument) => ({ mode: "focus" as const, success: true, durationMs: 10, compiledAt: "2026-10-13", log: "", mainFile: doc.project.mainFile,
    engine: doc.project.engine, sourceRevision: doc.revision, artifactKey: "a".repeat(16), pdfUrl: "/api/paperfocus/pdf/focus?build=" + "a".repeat(16) });
  cache.remember(a, result(a)); cache.remember(b, result(b));
  assert.equal(cache.read(a)?.mainFile, a.project.mainFile); assert.equal(cache.read(b)?.mainFile, "notes.tex");
  assert.equal(cache.read({ ...a, revision: "changed-asset-or-source" }), undefined);
  assert.equal(cache.read({ ...a, project: { ...a.project, engine: "xelatex" } }), undefined);
  assert.equal(matchingManuscriptBuild(result(a), b), false);
  assert.equal(matchingManuscriptBuild({ ...result(a), stale: true }, a), false);
  const copy = cache.read(a)!; copy.log = "mutated"; assert.equal(cache.read(a)?.log, "");
  const fullOnly = new ManuscriptBuildCache(); fullOnly.remember(a, { ...result(a), mode: "full" }); assert.equal(fullOnly.read(a), undefined);
  const invalid = new ManuscriptBuildCache(); invalid.remember(a, { ...result(a), artifactKey: undefined }); assert.equal(invalid.read(a), undefined);
  for (let i = 0; i < 13; i++) { const doc = { ...a, project: { ...a.project, mainFile: `root-${i}.tex` } }; cache.remember(doc, result(doc)); }
  assert.equal(cache.read(a), undefined, "retained metadata is bounded");
});

test("new compiled PDFs retain page and offset within a manuscript view, never across roots or scopes", () => {
  const previous = { identity: "project:notes:all", position: { revision: "old.pdf", page: 7, top: 140, left: 35, scale: 0.8 } };
  const resumed = compiledPdfResume(previous, previous.identity, "new.pdf");
  assert.deepEqual(resumed, { ...previous.position, revision: "new.pdf" });
  assert.equal(previous.position.revision, "old.pdf", "captured position is not mutated");
  assert.equal(compiledPdfResume(previous, "project:paper:all", "new.pdf"), undefined);
  assert.equal(compiledPdfResume(previous, "project:notes:section", "new.pdf"), undefined);
  assert.equal(compiledPdfResume(previous, undefined, "new.pdf"), undefined);
});

test("scope PDF cache retains all-sections and individual sections independently at the exact saved revision", () => {
  const doc = document(), cache = new ManuscriptBuildCache();
  const all = manuscriptBuildScope({}), section = manuscriptBuildScope({ focusNodeId: "section-a" });
  const result = (focusNodeId?: string) => ({ mode: "focus" as const, success: true, durationMs: 1, compiledAt: "now", log: "",
    mainFile: doc.project.mainFile, engine: doc.project.engine, sourceRevision: doc.revision,
    artifactKey: (focusNodeId ? "b" : "a").repeat(16), pdfUrl: focusNodeId ? "/section.pdf" : "/all.pdf", scope: { focusNodeId } });
  cache.remember(doc, result()); cache.remember(doc, result("section-a"));
  assert.equal(cache.read(doc, all)?.pdfUrl, "/all.pdf");
  assert.equal(cache.read(doc, section)?.pdfUrl, "/section.pdf");
  assert.equal(cache.read(doc, manuscriptBuildScope({ focusNodeId: "section-b" })), undefined);
  assert.equal(cache.read({ ...doc, revision: "edited" }, all), undefined);
  assert.equal(cache.read(doc, manuscriptBuildScope({ hiddenNodeIds: ["section-a"] })), undefined);
  assert.equal(manuscriptBuildScope({ hiddenNodeIds: ["b", "a"] }), manuscriptBuildScope({ lens: "paper", hiddenNodeIds: ["a", "b"] }));
  const original = new ManuscriptBuildCache(); original.remember(doc, { ...result("section-a"), originalPages: [2] });
  assert.equal(original.read(doc, section), undefined, "original-page selections are not focused-scope artifacts");
});

test("quota recovery losslessly packs only inactive known copies and preserves live drafts", () => {
  const storage = new MemoryStorage(), raw = JSON.stringify({ ...state(), paragraphEdits: { p: "Unsaved math α 😀".repeat(10000) } });
  const old = "paperfocus.prototype.v1.paper.window.old", live = "paperfocus.prototype.v1.other.window.agent";
  storage.setItem(old, raw); storage.setItem(`${old}.savedAt`, "1");
  storage.setItem(live, raw); storage.setItem("active-writing.window.agent.alive", "299999");
  const recent = "paperfocus.prototype.v1.paper.window.recent";
  storage.setItem(recent, raw); storage.setItem(`${recent}.savedAt`, "299999");
  const malformed = "paperfocus.prototype.v1.paper.window.bad";
  storage.setItem(malformed, "invalid"); storage.setItem("unknown.window.old", raw);
  storage.setItem("paperfocus.prototype.v1.paper", raw);
  packInactiveBrowserRecoveries(storage, 300000);
  assert.ok(storage.getItem(old)!.length < raw.length);
  assert.equal(unpackBrowserRecovery(storage.getItem(old)!), raw);
  assert.equal(storage.getItem(live), raw); assert.equal(storage.getItem(recent), raw);
  assert.equal(storage.getItem(malformed), "invalid"); assert.equal(storage.getItem("unknown.window.old"), raw);
  assert.equal(storage.getItem("paperfocus.prototype.v1.paper"), raw);
  const reopened = createWindowStateCache(storage, new MemoryStorage(), "new", () => 300001);
  assert.equal(reopened.read("paperfocus.prototype.v1.paper", true, "old"), raw);
});

test("manuscript view snapshots are small, root-scoped and never borrow source or notebook drafts", () => {
  const current = { activeNodeId: "first", activeParagraphId: "p", focusedNodeId: "first", hiddenNodeIds: ["hidden"], collapsedNodeIds: ["folded"], progressByNode: { first: "done" },
    paragraphEdits: { p: "Human draft" }, notebookEntries: [{ id: "kept" }], turbo: freshTurbo(), destination: "notebook" } as unknown as AppState;
  const view = manuscriptView(current);
  assert.deepEqual(parseManuscriptView(view), view);
  assert.equal("paragraphEdits" in view, false); assert.equal("notebookEntries" in view, false);
  assert.notEqual(resumeKey("paper", "main.tex"), resumeKey("paper", "notes.tex"));
  const restored = restoreManuscriptView(current);
  assert.deepEqual(restored.progressByNode, {}); assert.equal(restored.activeNodeId, "");
  assert.equal(restored.paragraphEdits, current.paragraphEdits); assert.equal(restored.notebookEntries, current.notebookEntries);
  assert.equal(parseManuscriptView({ ...view, progressByNode: { first: "verified" } }), undefined);
});

test("inverse PDF source navigation preserves all/section/window modes and does not narrow to an environment", () => {
  const nodes = [{ id: "section", kind: "section", paragraphIds: [] },
    { id: "proof", kind: "proof", environment: "proof", parentId: "section", paragraphIds: ["p"] }] as ProjectDocument["nodes"];
  const all = { ...state(), focusedNodeId: undefined, paragraphEdits: { other: "Keep draft" }, hiddenNodeIds: ["section", "unrelated"] };
  const next = locateSourcePassage(all, "proof", "p", nodes);
  assert.equal(manuscriptScope(next), "all"); assert.equal(next.focusedNodeId, undefined);
  assert.equal(next.activeParagraphId, "p"); assert.equal(next.paragraphEdits, all.paragraphEdits);
  assert.deepEqual(next.hiddenNodeIds, ["unrelated"]);
  const section = locateSourcePassage({ ...all, focusedNodeId: "section" }, "proof", "p", nodes);
  assert.equal(section.focusedNodeId, "section"); assert.equal(manuscriptScope(section), "section");
  const elsewhere = locateSourcePassage({ ...all, focusedNodeId: "another-section" }, "proof", "p", nodes);
  assert.equal(elsewhere.focusedNodeId, "section"); assert.equal(manuscriptScope(elsewhere), "section");
  const window = locateSourcePassage({ ...all, blockWindow: { radius: 2, paragraphId: "old" } }, "proof", "p", nodes);
  assert.equal(manuscriptScope(window), "window"); assert.deepEqual(window.blockWindow, { radius: 2, paragraphId: "p" });
});

test("cell/output links round trip exact stable IDs, carry only same-app manuscript returns and never imply a run", () => {
  const base = "http://127.0.0.1:4189/", revision = "a".repeat(64);
  const back = `${base}?awProject=paper&awPanel=paper&awRoot=notes.tex&awRevision=${revision}&awParagraph=para&awNode=section`;
  const url = experimentCellUrl(base, "paper", "conversation", "cell_2", revision, 0, back), request = readWindowRequest(new URL(url).search)!;
  assert.equal(request.cellId, "cell_2"); assert.equal(request.outputIndex, 0); assert.equal(request.notebookId, "conversation"); assert.equal(request.evidenceRevision, revision);
  assert.equal(workspaceBackLink(base, request.backLink, "paper"), back);
  for (const invalid of ["https://example.org/", `${base}?awProject=other&awPanel=paper`, `${base}api/paperfocus/files?awProject=paper&awPanel=paper`, `${back}&awBack=x`]) assert.equal(workspaceBackLink(base, invalid, "paper"), undefined);
  assert.throws(() => experimentCellUrl(base, "paper", "conversation", "bad id", revision));
  assert.throws(() => experimentCellUrl(base, "paper", "conversation", "cell", revision, 30));
  assert.match(latexEvidenceLink(url, "Evidence & checks"), /\\href\{/); assert.match(latexEvidenceLink(url, "Evidence & checks"), /Evidence \\& checks/);
});

test("captured manuscript root ownership prevents reattaching identical paragraph IDs in another manuscript", () => {
  const document = { project: { mainFile: "notes.tex" }, revision: "same", paragraphs: [{ id: "p", nodeId: "n", file: "shared.tex", text: "Same text" }] } as ProjectDocument;
  const source = { rootFile: "paper.tex", paragraphId: "p", file: "shared.tex", paragraphText: "Same text", revision: "same" };
  assert.equal(locateSavedPassage(source, document, {}), undefined);
  assert.equal(locateSavedPassage({ ...source, rootFile: "notes.tex" }, document, {})?.id, "p");
});

test("browser recovery warnings identify cache failures and clear after a successful retry", async () => {
  let failed = true, calls = 0;
  const save = () => { calls++; if (failed) throw Object.assign(new Error("private draft must not appear in diagnostics"), { name: "QuotaExceededError" }); };
  const warning = saveBrowserRecovery(save);
  assert.match(warning!, /browser storage is full/);
  assert.match(warning!, /Disk saves are independent/);
  assert.equal(warning!.includes("private draft"), false);
  failed = false;
  assert.equal(saveBrowserRecovery(save), undefined);
  assert.equal(calls, 3, "quota failure gets one bounded retry before a later successful save");
  assert.match(browserRecoveryFailure({ name: "SecurityError" }), /access is blocked/);
  assert.match(browserRecoveryFailure(new Error("unknown")), /could not be updated/);
  const app = await readFile("src/App.tsx", "utf8");
  assert.match(app, /setBrowserRecoveryError\(document \? saveBrowserRecovery/);
  assert.match(app, /\[state, document, recoveryRetry\]/);
  assert.match(app, /Retry browser recovery/);
  assert.equal(app.includes('setProjectError("Browser storage'), false, "cache recovery cannot masquerade as a project-load failure");
});

test("quota retry reclaims only exact saved experiment copies across legacy/local/session caches", () => {
  const local = new MemoryStorage(), session = new MemoryStorage();
  const base = { nbformat: 4, cells: [{ source: "saved", outputs: [{ data: { "image/png": "x".repeat(2000) } }] }] };
  const clean = JSON.stringify({ base, notebook: base });
  const dirty = JSON.stringify({ base, notebook: { ...base, cells: [{ source: "unsaved" }] } });
  const key = "paperfocus:experiments:paper:owner:drafts.v2", legacy = key.replace(":drafts.v2", "");
  local.setItem(legacy, clean); local.setItem(`${key}.window.old`, clean);
  session.setItem(`${key}.window`, clean);
  local.setItem(`${key}.window.dirty`, dirty);
  local.setItem(`${key}.window.unknown`, JSON.stringify({ base, notebook: base, pending: "keep" }));
  local.setItem(`${key}.window.broken`, "{bad");
  local.setItem("paperfocus.prototype.v1.paper.window.old", "keep source recovery");
  local.setItem("other-app", clean);
  // A bare legacy notebook has no known merge baseline, so cannot be discarded.
  local.setItem("paperfocus:experiments:paper:bare", JSON.stringify(base));
  let saves = 0;
  const warning = saveBrowserRecovery(() => {
    saves++;
    if (local.getItem(legacy) !== "{}" || session.getItem(`${key}.window`) !== "{}")
      throw Object.assign(new Error("Full"), { name: "QuotaExceededError" });
  }, () => { compactBrowserExperimentRecoveries(local); compactBrowserExperimentRecoveries(session); });
  assert.equal(warning, undefined); assert.equal(saves, 2);
  assert.equal(local.getItem(`${key}.window.old`), "{}");
  assert.equal(local.getItem(`${key}.window.dirty`), dirty);
  assert.equal(JSON.parse(local.getItem(`${key}.window.unknown`)!).pending, "keep");
  assert.equal(local.getItem(`${key}.window.broken`), "{bad");
  assert.equal(local.getItem("paperfocus.prototype.v1.paper.window.old"), "keep source recovery");
  assert.equal(local.getItem("paperfocus:experiments:paper:bare"), JSON.stringify(base));
  assert.equal(local.getItem("other-app"), clean);
});

test("security failures never trigger quota compaction and failed retries keep the warning", () => {
  let compacted = 0, saves = 0;
  const blocked = saveBrowserRecovery(() => { saves++; throw { name: "SecurityError" }; }, () => { compacted++; });
  assert.match(blocked!, /access is blocked/); assert.equal(compacted, 0); assert.equal(saves, 1);
  const full = saveBrowserRecovery(() => { saves++; throw { name: "QuotaExceededError" }; }, () => { compacted++; });
  assert.match(full!, /storage is full/); assert.equal(compacted, 1); assert.equal(saves, 3);
});

test("clean experiment snapshots stay small and dirty snapshots retain the full merge baseline", () => {
  const base = { cells: [{ id: "cell", source: "saved", outputs: [{ data: { "image/png": "x".repeat(10000) } }] }] };
  assert.equal(experimentRecoverySnapshot(base, structuredClone(base), JSON.stringify), "{}");
  const draft = { ...base, cells: [...base.cells, { id: "new", source: "pending", outputs: [] }] };
  assert.deepEqual(JSON.parse(experimentRecoverySnapshot(base, draft, JSON.stringify)), { base, notebook: draft });
});

test("quota recovery compacts only this notebook's exact clean copies and preserves all drafts", () => {
  const local = new MemoryStorage(), session = new MemoryStorage();
  const key = "paperfocus:experiments:paper:owner:drafts.v2", base = { nbformat: 4, nbformat_minor: 5, cells: [{ source: "saved" }] };
  const clean = JSON.stringify({ base, notebook: base }), dirty = JSON.stringify({ base, notebook: { cells: [{ source: "unsaved" }] } });
  for (const name of [key, `${key}.window.closed`, `${key}.window.live`]) local.setItem(name, clean);
  local.setItem(`${key}.owner`, "closed"); local.setItem(`${key}.window.closed.savedAt`, "17");
  local.setItem(`${key}.window.dirty`, dirty); local.setItem(`${key}.window.broken`, "{bad");
  const unknown = JSON.stringify({ base, notebook: base, pending: "unknown draft" });
  local.setItem(`${key}.window.unknown`, unknown);
  const other = key.replace(":owner:", ":other:"); local.setItem(`${other}.window.closed`, clean);
  local.setItem("other-app", clean); local.setItem("paperfocus.prototype.v1.paper.window.draft", "source recovery");
  const total = () => [...local.values.values()].reduce((sum, value) => sum + value.length, 0);
  const quotaLimit = total();
  const originalSet = local.setItem.bind(local);
  local.setItem = (name, value) => { if (total() - (local.getItem(name)?.length ?? 0) + value.length > quotaLimit) throw Object.assign(new Error("Full"), { name: "QuotaExceededError" }); originalSet(name, value); };
  const cache = createWindowStateCache(local, session, "new");
  assert.throws(() => local.setItem("new-copy", clean), /Full/);
  cache.writeSnapshot(key, "{}", "{}");
  assert.equal(local.getItem(`${key}.window.closed`), "{}");
  assert.equal(local.getItem(`${key}.window.live`), "{}");
  assert.equal(local.getItem(`${key}.window.new`), "{}");
  assert.equal(local.getItem(`${key}.window.closed.savedAt`), "17");
  assert.equal(local.getItem(`${key}.window.dirty`), dirty);
  assert.equal(local.getItem(`${key}.window.broken`), "{bad");
  assert.equal(local.getItem(`${key}.window.unknown`), unknown);
  assert.equal(local.getItem(`${other}.window.closed`), clean);
  assert.equal(local.getItem("other-app"), clean);
  assert.equal(local.getItem("paperfocus.prototype.v1.paper.window.draft"), "source recovery");
  assert.equal(cache.read(key), "{}");
  assert.equal(session.getItem(`${key}.window`), "{}");
  compactSavedExperimentRecoveries(local, other.replace("paperfocus:", "unknown:"));
  assert.equal(local.getItem(`${other}.window.closed`), clean, "unknown namespaces are untouched");
});
function state(): AppState { return { destination: "manuscript", notebookEntries: [], suggestions: { relation: "related", minimized: true }, turbo: freshTurbo(),
  lens: "paper", displayMode: "source", activeNodeId: "section", activeParagraphId: "p", hiddenNodeIds: [], progressByNode: {}, paragraphEdits: {},
  rewriteSessions: [], attentionTasks: [], themeLenses: [], activeThemeId: "", previewMode: "split" }; }
function document(): ProjectDocument { return { project: { id: "paper", name: "Paper", folder: "paper", mainFile: "main.tex", createdAt: "now" },
  files: ["main.tex"], rootFiles: ["main.tex"], revision: "rev", nodes: [{ id: "section", title: "First", depth: 0, kind: "section", paragraphIds: ["p", "p2"] }],
  paragraphs: [{ id: "p", nodeId: "section", text: "First paragraph", file: "main.tex" }, { id: "p2", nodeId: "section", text: "Second paragraph", file: "main.tex" }] }; }

test("live windows retain separate source drafts and views, including after reload", () => {
  const local = new MemoryStorage(), aSession = new MemoryStorage(), bSession = new MemoryStorage();
  const a = createWindowStateCache(local, aSession, "a", () => 1000), b = createWindowStateCache(local, bSession, "b", () => 1000);
  const first = { ...state(), paragraphEdits: { p: "A draft" }, draftRevision: "rev", activeParagraphId: "p" };
  a.write("paper", first, JSON.stringify(first));
  assert.deepEqual(JSON.parse(b.read("paper")!).paragraphEdits, {}, "new live windows never borrow another window's draft");
  const second = { ...state(), destination: "notebook" as const, activeParagraphId: "p2", paragraphEdits: { p2: "B draft" } };
  b.write("paper", second, JSON.stringify(second));
  assert.deepEqual(JSON.parse(a.read("paper")!), first);
  assert.deepEqual(JSON.parse(createWindowStateCache(local, aSession, "reloaded").read("paper")!), first);
  assert.deepEqual(JSON.parse(b.read("paper")!), second);
  const checkpoint = JSON.parse(local.getItem("paper")!);
  assert.deepEqual(checkpoint.paragraphEdits, {}); assert.deepEqual(checkpoint.notebookEntries, []);
  assert.equal(checkpoint.draftRevision, undefined);
});

test("legacy recovery survives migration; closed copies can be explicitly recovered without changing the active window", () => {
  const local = new MemoryStorage(), session = new MemoryStorage(), legacy = { ...state(), paragraphEdits: { p: "Unsaved legacy draft" } };
  local.setItem("paper", JSON.stringify(legacy));
  const a = createWindowStateCache(local, session, "a", () => 1000);
  assert.deepEqual(JSON.parse(a.read("paper")!), legacy);
  a.write("paper", legacy, JSON.stringify(legacy)); a.release();
  const b = createWindowStateCache(local, new MemoryStorage(), "b", () => 1001);
  assert.deepEqual(JSON.parse(b.read("paper")!), legacy, "ordinary reopening recovers the last closed window");
  assert.deepEqual(JSON.parse(b.read("paper", true)!).paragraphEdits, {}, "deliberate new views start clean");
  b.write("paper", state(), JSON.stringify(state()));
  const copies = listWindowRecoveries(local, "paper", "b"); assert.equal(copies.length, 1); assert.equal(copies[0].draftCount, 1);
  const recovery = createWindowStateCache(local, new MemoryStorage(), "recovery", () => 1002);
  assert.deepEqual(JSON.parse(recovery.read("paper", true, copies[0].id)!), legacy);
  assert.deepEqual(JSON.parse(b.read("paper")!).paragraphEdits, {});
  assert.equal(local.getItem("paper.window.a"), JSON.stringify(legacy));
});

test("browser reopening resumes the last-used project while existing and companion windows keep their own", () => {
  const local = new MemoryStorage(), a = new MemoryStorage(), b = new MemoryStorage();
  rememberProject(a, local, "first"); rememberProject(b, local, "second");
  assert.equal(startupProject(a, local), "first"); assert.equal(startupProject(b, local), "second");
  assert.equal(startupProject(new MemoryStorage(), local), "second");
  rememberProject(a, local, "first", false); assert.equal(local.getItem(lastProjectKey), "second");
  rememberProject(a, local, "first"); assert.equal(startupProject(new MemoryStorage(), local), "first");
  const request = readWindowRequest("?awProject=explicit&awPanel=notebook")!;
  assert.equal(startupProject(new MemoryStorage(), local, request), "explicit");
  assert.equal(startupProject(b, local, request), "second", "refresh a companion after navigating away from its original URL");
  b.setItem(sessionProjectKey,"../../invalid"); local.setItem(lastProjectKey,"bad\nproject"); assert.equal(startupProject(b, local),undefined);
});

test("raw and experiment drafts retain window-local recovery without lending another live window's text", () => {
  const local = new MemoryStorage(), aSession = new MemoryStorage(), bSession = new MemoryStorage();
  const a = createWindowStateCache(local,aSession,"a",()=>1000), b = createWindowStateCache(local,bSession,"b",()=>1001);
  for (const key of ["active-writing.raw.v2.paper.main.tex","paperfocus:experiments:paper:conversation:drafts.v2"]) {
    const first=JSON.stringify({base:"saved",draft:"A private draft"}), clean=JSON.stringify({base:"saved",draft:"saved"});
    a.writeSnapshot(key,first,clean);
    assert.equal(b.read(key),clean);
    assert.equal(createWindowStateCache(local,aSession,"refresh").read(key),first);
    const second=JSON.stringify({base:"saved",draft:"B private draft"}); b.touch(); b.writeSnapshot(key,second,clean);
    assert.equal(a.read(key),first); assert.equal(b.read(key),second);
    b.release(); b.writeSnapshot(key,second,clean); assert.equal(local.getItem("active-writing.window.b.alive"),null,"late pagehide writes cannot revive a closed lease");
    const reopened=createWindowStateCache(local,new MemoryStorage(),"new",()=>1002);
    assert.equal(reopened.read(key),second); assert.equal(reopened.read(key,true),clean);
    b.touch(); b.clearOwn(key); assert.equal(a.read(key),first);
  }
});

test("view and reading checkpoints validate inputs and retain independent window locations", () => {
  const local=new MemoryStorage(), a=createWindowStateCache(local,new MemoryStorage(),"a",()=>1), b=createWindowStateCache(local,new MemoryStorage(),"b",()=>1);
  const view={version:1,rootFile:"main.tex",previewFormat:"reading",rawEditor:true,sourceFile:"appendix.tex",sourcePosition:{paragraphId:"p",nodeId:"section",paragraphText:"First paragraph",file:"main.tex",revision:"rev",viewportOffset:125}};
  const key=resumeKey("paper"); a.writeSnapshot(key,JSON.stringify(view),JSON.stringify(view));
  const changed={...view,previewFormat:"pdf",rawEditor:false}; b.writeSnapshot(key,JSON.stringify(changed),JSON.stringify(changed));
  assert.deepEqual(parseWorkspaceResume(a.read(key)),view); assert.deepEqual(parseWorkspaceResume(b.read(key)),changed);
  assert.equal(parseWorkspaceResume("broken"),undefined); assert.equal(parseWorkspaceResume(JSON.stringify({...view,previewFormat:"script"})),undefined);
  assert.equal(parseWorkspaceResume(JSON.stringify({...view,sourcePosition:{...view.sourcePosition,viewportOffset:"125"}}))?.sourcePosition,undefined);
  assert.deepEqual(parseReadingPosition(JSON.stringify({top:550,left:0,revision:"pdf-url",page:3,scale:1.2})),{top:550,left:0,revision:"pdf-url",page:3,scale:1.2});
  for(const patch of [{top:-1},{left:"4"},{page:0},{page:1.5},{scale:0}])assert.equal(parseReadingPosition(JSON.stringify({top:0,left:0,revision:"rev",...patch})),undefined);
});

test("crashed leases expire and quota failures never replace an older recovery checkpoint", () => {
  const local = new MemoryStorage(), session = new MemoryStorage(); let now = 1;
  const a = createWindowStateCache(local, session, "a", () => now);
  const draft = { ...state(), paragraphEdits: { p: "Draft" } }; a.write("paper", draft, JSON.stringify(draft));
  now += 180001;
  const b = createWindowStateCache(local, new MemoryStorage(), "b", () => now);
  assert.deepEqual(JSON.parse(b.read("paper")!).paragraphEdits, draft.paragraphEdits);
  const previous = local.getItem("paper"), pointer = local.getItem("paper.owner");
  const quota = { getItem: local.getItem.bind(local), removeItem: local.removeItem.bind(local), setItem: () => { throw new Error("Quota exceeded"); } };
  const c = createWindowStateCache(quota, new MemoryStorage(), "c"); assert.throws(() => c.write("paper", state(), JSON.stringify(state())));
  assert.equal(local.getItem("paper"), previous); assert.equal(local.getItem("paper.owner"), pointer);
});

test("companion startup clears only the new window's copied manuscript cache", () => {
  const parent = new MemoryStorage(); parent.setItem("paperfocus.prototype.v1.paper.window", "draft"); parent.setItem("active-writing.window.project", "paper");
  for (const key of ["active-writing.raw.v2.paper.main.tex.window", "active-writing.resume.v1.paper.window", "active-writing.reading.v1.paper.window", "paperfocus:experiments:paper:notes:drafts.v2.window"]) parent.setItem(key, "own pending text/view");
  parent.setItem("active-writing.zoom.source", "1.2"); parent.setItem("other-app", "retained");
  const child = new MemoryStorage(); child.values = new Map(parent.values); resetCompanionSession(child);
  assert.equal(child.getItem("paperfocus.prototype.v1.paper.window"), null); assert.equal(child.getItem("active-writing.window.project"), null);
  assert.equal(child.getItem("active-writing.zoom.source"), "1.2"); assert.equal(child.getItem("other-app"), "retained");
  assert.equal([...child.values.keys()].filter(key => key.endsWith(".window")).length, 0);
  assert.equal(parent.getItem("paperfocus.prototype.v1.paper.window"), "draft");
});

test("second-screen links identify exact source locations without copying manuscript text or selecting the global project", () => {
  const doc = document(), original = { ...state(), activeParagraphId: "p2", focusedNodeId: "section", blockWindow: { radius: 2, paragraphId: "p2" } };
  const url = windowWorkspaceUrl("http://127.0.0.1:4189/?old=value#old", doc, original, "notebook", "pdf");
  const request = readWindowRequest(new URL(url).search)!;
  assert.equal(new URL(url).origin, "http://127.0.0.1:4189"); assert.equal(request.projectId, "paper");
  assert.equal(url.includes("First paragraph"), false); assert.equal(url.includes("old=value"), false);
  const next = applyWindowRequest(original, doc, request);
  assert.equal(next.destination, "notebook"); assert.equal(next.activeParagraphId, "p2"); assert.equal(next.blockWindow, undefined);
  assert.equal(original.focusedNodeId, "section"); assert.equal(next.previewMode, "hidden");
  assert.equal(applyWindowRequest(original, doc, { ...request, projectId: "another" }), original);
  assert.equal(applyWindowRequest(original, doc, { ...request, revision: "stale" }).activeParagraphId, undefined, "never reuse stale ordinal IDs");
  assert.equal(applyWindowRequest(original, doc, { ...request, panel: "preview" }).previewMode, "full");
  assert.equal(applyWindowRequest(original, doc, { ...request, panel: "paper" }).previewMode, "split");
  assert.equal(readWindowRequest("?awProject=paper&awPanel=paper")?.format, "pdf");
  assert.equal(readWindowRequest("?awProject=paper&awPanel=paper&awFormat=reading")?.format, "reading");
  assert.equal(readWindowRequest("?awProject=paper&awPanel=invalid"), undefined);
  assert.equal(readWindowRequest("?awProject=paper&awPanel=paper&awRecover=../outside")!.recoveryId, undefined);
});

test("explicit manuscript links open known roots, without redirecting unsettled source or recovery windows", () => {
  const doc = { ...document(), rootFiles: ["main.tex", "notes.tex"] };
  const request = { projectId: "paper", panel: "paper", rootFile: "notes.tex", revision: "", format: "pdf" } as const;
  assert.equal(automaticLinkedManuscript(request, doc, state()), "notes.tex");
  assert.equal(automaticLinkedManuscript(request, doc, { ...state(), paragraphEdits: { p: "Human draft" } }), undefined);
  assert.equal(automaticLinkedManuscript(request, doc, state(), true), undefined);
  for (const patch of [{ projectId: "other" }, { panel: "notebook" as const }, { recoveryId: "ours" }, { rootFile: "unknown.tex" }, { rootFile: doc.project.mainFile }]) {
    assert.equal(automaticLinkedManuscript({ ...request, ...patch }, doc, state()), undefined);
  }
});

test("window messages contain bounded IDs and checks, not untrusted progress maps", () => {
  const valid = { sender: "a", projectId: "paper", kind: "progress", rootFile: "main.tex", revision: "rev", changes: { section: "done" } };
  assert.equal(validWindowMessage(valid), true);
  for (const changes of [null, [], { section: "resolved" }, JSON.parse('{"__proto__":"done"}'), { constructor: "done" }]) assert.equal(validWindowMessage({ ...valid, changes }), false);
  assert.equal(validWindowMessage({ ...valid, sender: "x".repeat(201) }), false);
  assert.equal(validWindowMessage({ ...valid, kind: "launch" }), false);
});

async function fixture() {
  const base = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "windows-")), folder = path.join(workspace, "paper"); await mkdir(folder);
  await writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{First}\nFirst paragraph.\n\nSecond paragraph.\n\\end{document}\n");
  const project = await registerProject(workspace, "paper"); return { workspace, folder, project };
}

test("two source writers rebase independent paragraphs, but an overlapping draft remains untouched", async () => {
  const f = await fixture(), before = publicDocument(await parseProject(f.workspace, f.project.id));
  const [first, second] = before.paragraphs;
  const draft = { ...state(), activeNodeId: second.nodeId, activeParagraphId: second.id, paragraphEdits: { [second.id]: "Second window's edit." }, draftRevision: before.revision };
  await saveEdits(f.workspace, f.project.id, { [first.id]: "First window's edit." }, before.revision);
  await assert.rejects(saveEdits(f.workspace, f.project.id, draft.paragraphEdits, before.revision), /changed on disk/);
  const incoming = publicDocument(await parseProject(f.workspace, f.project.id)), merged = automaticSourceRefresh(draft, before, incoming)!;
  assert.ok(merged); assert.equal(merged.state.activeParagraphId, second.id);
  await saveEdits(f.workspace, f.project.id, merged.state.paragraphEdits, merged.state.draftRevision);
  const source = await readFile(path.join(f.folder, "main.tex"), "utf8"); assert.match(source, /First window's edit/); assert.match(source, /Second window's edit/);
  const overlapping = { ...draft, paragraphEdits: { [first.id]: "Competing text." } };
  assert.equal(automaticSourceRefresh(overlapping, before, incoming), undefined); assert.equal(overlapping.paragraphEdits[first.id], "Competing text.");
});

test("shared queue refresh preserves window location and source drafts, with both contested versions available", () => {
  const base = emptyWorkbench(), local = state(); local.workbenchSync = workbenchSync(base, 0); local.paragraphEdits = { p: "Own source" };
  const task = { id: "comment", title: "Human comment", nodeId: "section", route: "codex" as const, status: "ready" as const, createdAt: "now", updatedAt: "now", replyDraft: "One version" };
  local.attentionTasks = [task];
  const received = receiveWorkbench(local, { ...base, version: 1, revision: 1, attentionTasks: [{ ...task, replyDraft: "Other version" }] });
  assert.equal(received.activeParagraphId, local.activeParagraphId); assert.equal(received.paragraphEdits, local.paragraphEdits);
  assert.equal(received.attentionTasks[0].replyDraft, "One version"); assert.equal(received.recoveredWorkbenchDrafts!.length, 1);
  assert.equal(received.attentionTasks[0].status, "ready");
});

test("shared-store conditional reads return no body when unchanged and detect actual file changes at the same revision", async () => {
  const f = await fixture(); let handler: any;
  (latexPlugin(f.workspace).configureServer as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  async function get(kind: string, etag?: string) {
    const req = Object.assign(Readable.from([]), { method: "GET", url: `/api/paperfocus/${kind}?projectId=${f.project.id}`, headers: { host: "127.0.0.1:4189", ...(etag ? { "if-none-match": etag } : {}) } });
    const headers: Record<string, string> = {}, res: any = { setHeader: (key: string, value: string) => { headers[key.toLowerCase()] = value; }, end: (raw = "") => { res.raw = raw; } };
    await handler(req, res, () => assert.fail("endpoint must handle the request")); return { ...res, headers };
  }
  for (const kind of ["notebook", "workbench"]) {
    const first = await get(kind); assert.equal(first.statusCode, 200); assert.equal(first.headers["cache-control"], "no-store"); assert.ok(first.headers.etag);
    const unchanged = await get(kind, first.headers.etag); assert.equal(unchanged.statusCode, 304); assert.equal(unchanged.raw, "");
  }
  const first = await get("workbench");
  const disk = { ...JSON.parse(first.raw), queueLastActiveAt: "2026-10-06T12:00:00Z" };
  await writeFile(path.join(f.workspace, ".paperfocus/project-data", f.project.id, "workbench.json"), JSON.stringify(disk));
  const changed = await get("workbench", first.headers.etag); assert.equal(changed.statusCode, 200); assert.notEqual(changed.headers.etag, first.headers.etag);
});

test("background synchronization cannot compile or start agents and stale snapshots retain their original revision", async () => {
  const files = await Promise.all(["src/useSharedStorePoll.ts", "src/useNotebookPersistence.ts", "src/useWorkbenchPersistence.ts", "src/useSourceMonitor.ts"].map(file => readFile(file, "utf8")));
  for (const file of files) { assert.equal(file.includes("/compile"), false); assert.equal(file.includes("local-rewrite/start"), false); }
  for (const hook of files.slice(1, 3)) { assert.match(hook, /revision.current !== expectedRevision/); assert.match(hook, /saved.current !== expectedBaseline/); assert.match(hook, /revision: expectedRevision/); assert.match(hook, /If-None-Match/); }
});

test("source changes refresh automatically and overlapping chunk/raw edits show the incoming text without replacing drafts", async () => {
  const [app, monitor, raw, panel] = await Promise.all(["src/App.tsx", "src/useSourceMonitor.ts", "src/components/PlainSourceEditor.tsx", "src/components/SourceRefresh.tsx"].map(file => readFile(file, "utf8")));
  assert.match(monitor, /3_000 \* Math.max\(1, failures\)/); assert.match(monitor, /visibilitychange/);
  assert.match(app, /if \(sourceMonitor.changed\) void receiveWindowSource\(\)/);
  assert.match(app, /if \(plan.conflicts.length\) \{ setIncomingSource\(incoming\); setSourcePanelOpen\(true\); \}/);
  assert.match(app, /aria-label=".*source.*"|Other edits/);
  assert.match(raw, /if\(incoming.source===old.source\)\{baseline.current=incoming;return;\}/);
  assert.match(raw, /aria-label="Incoming LaTeX source" readOnly/);
  assert.match(panel, /Your unfinished edit/); assert.match(panel, /New text at the old position/);
  assert.match(app, /setCompileStale\(true\)/); // Incoming source marks the PDF stale, never requests a new compilation.
});
