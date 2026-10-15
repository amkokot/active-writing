import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AttentionTask, HandoffDraft, ManuscriptNode, Paragraph, ProjectDocument } from "../src/types.ts";
import { captureTaskSource, checkTaskSource, handoffExcerptSummary, prepareSourceHandoff, sourceHandoffContext, taskSourceTarget } from "../src/taskSource.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { readWorkbench, validateWorkbench, writeWorkbench } from "./workbenchStore.ts";
import { parseProject, registerProject } from "./projects.ts";

const nodes: ManuscriptNode[] = [
  { id: "intro", title: "Introduction", kind: "section", depth: 0, paragraphIds: ["p0", "p1"] },
  { id: "lemma", title: "Lemma", kind: "lemma", depth: 1, parentId: "intro", paragraphIds: ["statement"] },
  { id: "proof", title: "Proof", kind: "proof", depth: 2, parentId: "lemma", paragraphIds: ["argument"] },
  { id: "other", title: "Other work", kind: "section", depth: 0, paragraphIds: ["other-p"] },
];
const paragraphs: Paragraph[] = [
  { id: "p0", nodeId: "intro", file: "main.tex", text: "The bound $x  \\leq 1$ holds; see \\ref{lem}." },
  { id: "p1", nodeId: "intro", file: "main.tex", text: "An unchanged discussion." },
  { id: "statement", nodeId: "lemma", file: "sections/theory.tex", text: "For $a>0$, \\label{lem} this holds." },
  { id: "argument", nodeId: "proof", file: "sections/theory.tex", text: "By \\cite{paper}, the proof follows." },
  { id: "other-p", nodeId: "other", file: "main.tex", text: "Independent work." },
];
function document(): ProjectDocument { return { project: { id: "paper", name: "Trial", folder: "paper", mainFile: "main.tex", createdAt: "now" }, files: ["main.tex", "sections/theory.tex"], rootFiles: ["main.tex"], nodes: structuredClone(nodes), paragraphs: structuredClone(paragraphs), revision: "original" }; }
const auto: HandoffDraft = { effort: 1, scope: "auto", includeProject: false, instruction: "Explain this step", contextMode: "continuation" };
function task(snapshot: ReturnType<typeof captureTaskSource>): AttentionTask { return { id: "request", title: "Source trial", nodeId: snapshot.nodeId, paragraphId: snapshot.focusParagraphId, sourceSnapshot: snapshot, packet: "Immutable request", route: "codex", status: "queued", createdAt: "now", updatedAt: "now" }; }

test("handoff scope summary makes the paragraph-only boundary explicit", () => {
  const snapshot = captureTaskSource(document(), nodes[0], {}, "section", "p0");
  assert.match(handoffExcerptSummary("paragraph", "Only this paragraph", snapshot), /Active paragraph only.*Nearby statements and proofs are not included/);
  assert.match(handoffExcerptSummary("section", "Section context", snapshot), /4 paragraphs.*Includes results and proofs in this section, not other sections/);
  assert.match(handoffExcerptSummary("paragraph", "", snapshot), /No passage available/);
});

test("continuation summary never counts old tracked paragraphs as newly pasted text", () => {
  const snapshot = captureTaskSource(document(), nodes[0], {}, "section", "p0");
  assert.match(handoffExcerptSummary("auto", "", snapshot), /No new passage included/);
  assert.match(handoffExcerptSummary("auto", "Source-check note", snapshot), /Changed text/);
  assert.doesNotMatch(handoffExcerptSummary("none", "ignored", snapshot), /4 paragraphs/);
  assert.match(handoffExcerptSummary("section", "Long context", { ...snapshot, paragraphs: [], unavailableReason: "oversized" }), /too large to track changes/);
});

test("source snapshots preserve literal multi-file math and nested proofs without unrelated branches", () => {
  const doc = document(); const original = structuredClone(doc);
  const snapshot = captureTaskSource(doc, nodes[0], { statement: "Edited $a>0$, \\label{lem}." }, "section", "p0");
  assert.deepEqual(snapshot.paragraphs.map((p) => p.id), ["p0", "p1", "statement", "argument"]);
  assert.equal(snapshot.paragraphs[0].text, paragraphs[0].text);
  assert.equal(snapshot.paragraphs[2].text, "Edited $a>0$, \\label{lem}.");
  assert.equal(snapshot.paragraphs[2].file, "sections/theory.tex");
  assert.deepEqual(doc, original, "capturing and comparison cannot modify manuscript source");
  assert.equal(captureTaskSource(doc, nodes[0], {}, "paragraph", "missing").paragraphs.length, 0);
});

test("unchanged continuations omit excerpts; changed wider context is honestly noted", () => {
  const doc = document(); const snapshot = captureTaskSource(doc, nodes[0], {}, "paragraph", "p0");
  const prepared = prepareSourceHandoff(doc, nodes[0], {}, auto, "p0", snapshot);
  assert.equal(prepared.check.status, "unchanged"); assert.equal(prepared.context, "");
  const changed = { ...doc, revision: "macro-edit" };
  const check = checkTaskSource(snapshot, changed);
  assert.equal(check.status, "unchanged"); assert.equal(check.documentChanged, true);
  const text = sourceHandoffContext(snapshot, check);
  assert.match(text, /macros, bibliography, and wider context/); assert.ok(!text.includes(paragraphs[0].text));
  assert.ok(prepareSourceHandoff(doc, nodes[0], {}, { ...auto, contextMode: "briefing" }, "p0", snapshot).context.includes(paragraphs[0].text));
});

test("changed text is compactly supplied once; uncertain ordinal identity never becomes a safe jump", () => {
  const doc = document(); const snapshot = captureTaskSource(doc, nodes[0], {}, "section", "p0");
  const edits = { p0: "A revised $x  \\leq 1$ claim with \\ref{lem}." };
  const prepared = prepareSourceHandoff(doc, nodes[0], edits, auto, "p0", snapshot);
  assert.equal(prepared.check.status, "changed"); assert.equal(prepared.check.target, undefined);
  assert.match(prepared.context, /identity not verified/); assert.ok(prepared.context.includes(edits.p0));
  assert.ok(!prepared.context.includes(paragraphs[1].text)); assert.ok(!prepared.context.includes(paragraphs[3].text));
  assert.equal(snapshot.paragraphs[0].text, paragraphs[0].text, "original request is immutable");
  assert.equal(prepared.snapshot!.paragraphs[0].locationUnverified, true);
  const next = prepareSourceHandoff(doc, nodes[0], edits, auto, "p0", prepared.snapshot);
  assert.ok(!next.context.includes(edits.p0), "do not repeat already supplied comparison text");
  assert.equal(taskSourceTarget(next.snapshot, doc, edits, task(snapshot)), undefined);
  const explicit = prepareSourceHandoff(doc, nodes[0], edits, { ...auto, scope: "paragraph" }, "p0", prepared.snapshot);
  assert.equal(explicit.snapshot!.locationUnverified, undefined, "explicitly selecting fresh source starts a new exact baseline");
  assert.deepEqual(checkTaskSource(explicit.snapshot, doc, edits).target, { nodeId: "intro", paragraphId: "p0" });
  const excluded = prepareSourceHandoff(doc, nodes[0], edits, { ...auto, scope: "none" }, "p0", snapshot);
  assert.equal(excluded.context, ""); assert.equal(excluded.snapshot, snapshot);
  assert.equal(prepareSourceHandoff(doc, nodes[0], edits, { ...auto, scope: "none" }, "p0").snapshot, undefined, "an omitted excerpt is not a supplied-source baseline");
  const proofOnly = prepareSourceHandoff(doc, nodes[0], { argument: "Changed proof context." }, auto, "p0", snapshot);
  assert.equal(proofOnly.snapshot!.paragraphs.find((p) => p.id === "argument")!.locationUnverified, true);
  assert.deepEqual(checkTaskSource(proofOnly.snapshot, doc, { argument: "Changed proof context." }).target, { nodeId: "intro", paragraphId: "p0" }, "uncertainty in another object cannot disable an exactly matched focus");
});

test("inserting paragraphs cannot redirect an exact-source return to a reused ordinal ID", () => {
  const doc = document(); const snapshot = captureTaskSource(doc, nodes[0], {}, "paragraph", "p0");
  doc.revision = "inserted";
  doc.paragraphs = [{ ...paragraphs[0], text: "New inserted paragraph." }, { ...paragraphs[0], id: "p1" }, { ...paragraphs[1], id: "p2" }, ...doc.paragraphs.slice(2)];
  const check = checkTaskSource(snapshot, doc);
  assert.equal(check.status, "relocated"); assert.deepEqual(check.target, { nodeId: "intro", paragraphId: "p1" });
  assert.equal(check.matches[0].after!.text, snapshot.paragraphs[0].text);
  const prepared = prepareSourceHandoff(doc, nodes[0], {}, auto, "p0", snapshot);
  assert.equal(prepared.snapshot!.focusParagraphId, "p1"); assert.ok(!prepared.context.includes(paragraphs[0].text));
  doc.nodes[0].id = "renamed"; doc.paragraphs[1].nodeId = "renamed";
  assert.deepEqual(checkTaskSource(snapshot, doc).target, { nodeId: "renamed", paragraphId: "p1" }, "literal paragraph relocation can survive a section rename");
});

test("duplicate, deleted, cross-file and cross-project sources are not guessed", () => {
  const original = document(); const snapshot = captureTaskSource(original, nodes[0], {}, "paragraph", "p0");
  const duplicate = document(); duplicate.revision = "changed"; duplicate.paragraphs.push({ ...paragraphs[0], id: "copy", nodeId: "other" });
  assert.equal(checkTaskSource(snapshot, duplicate).status, "ambiguous"); assert.equal(checkTaskSource(snapshot, duplicate).target, undefined);
  const removed = document(); removed.revision = "changed"; removed.paragraphs = removed.paragraphs.filter((p) => p.id !== "p0");
  assert.equal(checkTaskSource(snapshot, removed).status, "missing"); assert.equal(checkTaskSource(snapshot, removed).target, undefined);
  const movedFile = document(); movedFile.revision = "changed"; movedFile.paragraphs[0].file = "different.tex";
  assert.equal(checkTaskSource(snapshot, movedFile).status, "missing");
  assert.equal(checkTaskSource(snapshot, { ...original, project: { ...original.project, id: "other-paper" } }).status, "unavailable");
  assert.equal(checkTaskSource(snapshot, { ...original, project: { ...original.project, mainFile: "other-root.tex" } }).status, "unavailable");
  assert.equal(checkTaskSource(undefined, original).status, "unknown");
  assert.equal(prepareSourceHandoff(original, nodes[0], {}, auto, "p0").snapshot, undefined, "do not fabricate legacy source context");
  assert.equal(taskSourceTarget(snapshot, removed, {}, task(snapshot)), undefined);
  const formerlyDuplicate = document(); formerlyDuplicate.paragraphs.push({ ...paragraphs[0], id: "old-copy", nodeId: "other" });
  const duplicateBaseline = captureTaskSource(formerlyDuplicate, nodes[0], {}, "paragraph", "p0");
  assert.equal(duplicateBaseline.paragraphs[0].duplicateAtCapture, true);
  formerlyDuplicate.revision = "one-copy-removed"; formerlyDuplicate.paragraphs = formerlyDuplicate.paragraphs.filter((p) => p.id !== "p0");
  assert.equal(checkTaskSource(duplicateBaseline, formerlyDuplicate).status, "ambiguous", "a sole surviving old duplicate is not evidence of relocation");
  assert.equal(checkTaskSource(duplicateBaseline, formerlyDuplicate).target, undefined);
});

test("section comparisons detect added and removed paragraphs without treating reused IDs as edited originals", () => {
  const doc = document(); const snapshot = captureTaskSource(doc, nodes[0], {}, "section", "p0");
  doc.revision = "section-change";
  doc.paragraphs = [{ ...paragraphs[1], id: "p0" }, { ...paragraphs[1], id: "p1", text: "New section discussion." }, ...paragraphs.slice(2)];
  const check = checkTaskSource(snapshot, doc);
  assert.equal(check.matches[0].state, "missing"); assert.equal(check.matches[1].state, "relocated");
  assert.deepEqual(check.added.map((p) => p.text), ["New section discussion."]);
  assert.equal(check.target, undefined); assert.equal(check.status, "missing");
  const packet = sourceHandoffContext(snapshot, check); assert.match(packet, /New section discussion/); assert.match(packet, /is missing/);
  doc.nodes = doc.nodes.filter((node) => node.id !== "intro");
  assert.equal(checkTaskSource(snapshot, doc).scopeMissing, true);
  assert.deepEqual(checkTaskSource(snapshot, doc).added, [], "do not infer a renamed section subtree from similarly titled objects");
});

test("an edited and shifted excerpt cannot turn the newly inserted old-position text into its baseline", () => {
  const doc = document(); const section = captureTaskSource(doc, nodes[0], {}, "section", "p0");
  const paragraph = captureTaskSource(doc, nodes[0], {}, "paragraph", "p0");
  doc.revision = "edited-and-inserted";
  doc.paragraphs = [{ ...paragraphs[0], text: "Inserted text." }, { ...paragraphs[0], id: "p1", text: "Changed original bound." }, { ...paragraphs[1], id: "p2" }, ...paragraphs.slice(2)];
  const check = checkTaskSource(section, doc);
  assert.equal(check.matches[0].state, "missing"); assert.equal(check.matches[0].after, undefined);
  assert.deepEqual(check.added.map((p) => p.text), ["Inserted text.", "Changed original bound."]);
  assert.equal(checkTaskSource(paragraph, doc).matches[0].state, "missing", "even a paragraph-only snapshot records the old block count");
  assert.equal(prepareSourceHandoff(doc, nodes[0], {}, auto, "p0", section).snapshot, section, "do not advance to an inferred substitute");
});

test("snapshot limits fail visibly without silent truncation and saved-work validation covers all new fields", () => {
  const doc = document(); doc.paragraphs[0].text = "x".repeat(100_001);
  const snapshot = captureTaskSource(doc, nodes[0], {}, "paragraph", "p0");
  assert.equal(snapshot.unavailableReason, "oversized"); assert.deepEqual(snapshot.paragraphs, []);
  assert.equal(checkTaskSource(snapshot, doc).status, "unavailable");
  const saved = { ...emptyWorkbench(), attentionTasks: [task(snapshot)], handoffDrafts: { "codex:intro": auto } }; validateWorkbench(saved);
  for (const change of [(s: any) => { s.version = 2; }, (s: any) => { s.locationUnverified = "yes"; }, (s: any) => { s.paragraphs = [paragraphs[0]]; },
    (s: any) => { delete s.unavailableReason; s.paragraphs = Array.from({ length: 501 }, (_, i) => ({ ...paragraphs[0], id: String(i) })); },
    (s: any) => { delete s.unavailableReason; s.paragraphs = [{ ...paragraphs[0], text: "x".repeat(100_001) }]; }]) {
    const invalid = structuredClone(saved); change(invalid.attentionTasks[0].sourceSnapshot); assert.throws(() => validateWorkbench(invalid));
  }
});

test("source snapshots round-trip on disk and reflect real parser ID shifts without source edits", async () => {
  const base = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "source-check-")); const folder = path.join(workspace, "paper"); await mkdir(folder);
  const source = "\\documentclass{article}\n\\begin{document}\n\\section{Result}\nAn original bound $x\\leq 1$.\n\nAn independent explanation.\n\\end{document}\n";
  await writeFile(path.join(folder, "main.tex"), source);
  const project = await registerProject(workspace, "paper"); const parsed = await parseProject(workspace, project.id);
  const first = parsed.paragraphs.find((p) => p.text.includes("original bound"))!;
  const node = parsed.nodes.find((n) => n.id === first.nodeId)!;
  const snapshot = captureTaskSource(parsed, node, {}, "paragraph", first.id);
  const saved = { ...emptyWorkbench(), attentionTasks: [task(snapshot)], handoffDrafts: { "codex:result": auto } };
  await writeWorkbench(workspace, project.id, 0, saved);
  assert.deepEqual((await readWorkbench(workspace, project.id)).attentionTasks[0].sourceSnapshot, snapshot);
  assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), source);
  const inserted = source.replace("An original", "Inserted prose.\n\nAn original"); await writeFile(path.join(folder, "main.tex"), inserted);
  const reparsed = await parseProject(workspace, project.id); const check = checkTaskSource(snapshot, reparsed);
  assert.equal(check.status, "relocated"); assert.notEqual(check.target!.paragraphId, first.id);
  assert.equal(reparsed.paragraphs.find((p) => p.id === check.target!.paragraphId)!.text, first.text);
  assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), inserted);
});
