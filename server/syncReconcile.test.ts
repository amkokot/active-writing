import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPaperProject } from "./projectFiles.ts";
import { getProject } from "./projects.ts";
import { captureSyncSnapshot, initializeSyncDevice } from "./deviceSync.ts";
import { stageSyncSnapshot, previewStagedSync } from "./syncStaging.ts";
import { syncAgentSummary, syncExactConflict, syncExactFile, saveSyncReconciliation, prepareSyncReconciliation } from "./syncReconcile.ts";
import { makeSnapshot, syncRecord } from "./syncProtocol.ts";
import { mergeLiteralText, textMergeLimits } from "./syncText.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { writeWorkbench } from "./workbenchStore.ts";
import { syncCommand } from "../scripts/awSync.ts";

const originalText = "First idea.\n\nStable context.\n\nLast idea.\n";
const leftText = originalText.replace("First idea.", "Human clarification."), rightText = originalText.replace("Last idea.", "Desktop deduction.");
const bytes = (value: string) => syncRecord("source/main.tex", "source", Buffer.from(value));
async function fixture(overlap = false, protectedReview?: unknown) {
  const parent = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(path.join(parent, "reconcile-")), project = await createPaperProject(workspace, "Synthetic reconciliation"), root = (await getProject(workspace, project.id)).root;
  await initializeSyncDevice(workspace, "Laptop");
  const review = structuredClone(protectedReview ?? emptyWorkbench()) as { attentionTasks: Array<{ sourceSnapshot?: { projectId: string } }> };
  for (const task of review.attentionTasks) if (task.sourceSnapshot) task.sourceSnapshot.projectId = project.id;
  await writeWorkbench(workspace, project.id, 0, review);
  await writeFile(path.join(root, "main.tex"), originalText); const base = await captureSyncSnapshot(workspace, project.id);
  await writeFile(path.join(root, "main.tex"), leftText); const local = await captureSyncSnapshot(workspace, project.id, base);
  const remote = makeSnapshot(project.id, { version: 1, id: "synthetic-desktop", label: "Desktop" }, base.records.map(record => record.path === "source/main.tex" ? bytes(overlap ? originalText.replace("First idea.", "Other first idea.") : rightText) : record), base);
  for (const snapshot of [base, local, remote]) await stageSyncSnapshot(workspace, project.id, snapshot);
  const plan = await previewStagedSync(workspace, project.id, local.id, remote.id);
  return { workspace, projectId: project.id, root, base, local, remote, planId: plan.id };
}

test("literal merge retains independent edits, CRLF, unicode, BOM and final newline exactly", () => {
  assert.equal(mergeLiteralText(originalText, leftText, rightText).text, leftText.replace("Last idea.", "Desktop deduction."));
  const base = "\uFEFFα\r\n\r\nβ\r\n", local = base.replace("α", "α₂"), remote = base.replace("β", "β₃");
  assert.equal(mergeLiteralText(base, local, remote).text, "\uFEFFα₂\r\n\r\nβ₃\r\n");
  assert.equal(mergeLiteralText("a\nb", "A\nb", "a\nB").text, "A\nB");
  assert.equal(mergeLiteralText("", "", "new").text, "new");
});
test("overlaps and ambiguous insertion boundaries stay conflicts; identical edits deduplicate", () => {
  assert.equal(mergeLiteralText("a\nb\n", "A\nb\n", "X\nb\n").status, "conflict");
  assert.equal(mergeLiteralText("a\nb\n", "a\ninsert\nb\n", "a\nB\n").status, "conflict");
  assert.equal(mergeLiteralText("a\n", "a\nL\n", "a\nR\n").status, "conflict");
  assert.equal(mergeLiteralText("a\nb\nc\n", "A\nb\nc\n", "A\nb\nC\n").text, "A\nb\nC\n");
});
test("text merging has finite byte, line and alignment budgets instead of unbounded retrying", () => {
  assert.equal(mergeLiteralText("", "x".repeat(textMergeLimits.bytes + 1), "").status, "too-large");
  const many = Array.from({ length: 1600 }, (_, index) => `${index}\n`).join("");
  assert.equal(mergeLiteralText(many, many.replaceAll(/\d+/g, "local"), many.replaceAll(/\d+/g, "remote")).status, "too-large");
  assert.equal(mergeLiteralText("a\n".repeat(13000), "b\n".repeat(13000), "c\n".repeat(13000)).status, "too-large");
});
test("literal merge matches independent coordinate edits across a deterministic set of cases", () => {
  for (let left = 0; left < 9; left++) for (let right = 0; right < 9; right++) {
    const base = Array.from({ length: 9 }, (_, i) => `${i}: original\n`), local = [...base], remote = [...base];
    local[left] = `${left}: local\n`; remote[right] = `${right}: remote\n`;
    const result = mergeLiteralText(base.join(""), local.join(""), remote.join(""));
    if (left === right) assert.equal(result.status, "conflict");
    else { const expected = [...base]; expected[left] = local[left]; expected[right] = remote[right]; assert.equal(result.text, expected.join("")); }
  }
});
test("a short change index and exact conflict/file reads do not claim scientific verification", async () => {
  const f = await fixture(), index = await syncAgentSummary(f.workspace, f.projectId, f.planId);
  assert.equal(index.changedFiles.length, 1); assert.equal(index.conflicts[0].ordinaryTextAllowed, true); assert.equal(index.approvalGranted, false);
  const exact = await syncExactConflict(f.workspace, f.projectId, f.planId, index.conflicts[0].id);
  assert.equal((exact.local as { text: string }).text, leftText);
  assert.equal(Buffer.from((await syncExactFile(f.workspace, f.projectId, f.planId, "source/main.tex", "remote")).data, "base64").toString(), rightText);
  await assert.rejects(() => syncExactFile(f.workspace, f.projectId, f.planId, "source/main.tex", "candidate"), /No file/);
});
test("simple source changes become a replayable detached proposal without touching the live paper", async () => {
  const f = await fixture(), proposed = await saveSyncReconciliation(f.workspace, f.projectId, f.planId);
  assert.equal(proposed.remaining.length, 0); assert.equal(proposed.proposedFiles[0].method, "literal-text");
  assert.equal((await saveSyncReconciliation(f.workspace, f.projectId, f.planId)).id, proposed.id);
  const prepared = await prepareSyncReconciliation(f.workspace, f.projectId, f.planId, proposed.id);
  assert.equal(await readFile(path.join(prepared.folder, "candidates/source/main.tex"), "utf8"), leftText.replace("Last idea.", "Desktop deduction."));
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), leftText); assert.equal(prepared.approvalGranted, false); assert.equal(prepared.liveImport, false);
  assert.equal((await prepareSyncReconciliation(f.workspace, f.projectId, f.planId, proposed.id)).folder, prepared.folder);
});
test("interrupted reconciliation keeps detached files and resumes without claiming premature readiness", async () => {
  const f = await fixture(), proposed = await saveSyncReconciliation(f.workspace, f.projectId, f.planId);
  await assert.rejects(() => prepareSyncReconciliation(f.workspace, f.projectId, f.planId, proposed.id, { afterCandidate: () => { throw new Error("Synthetic interruption"); } }), /interruption/);
  const folder = path.join(f.workspace, ".paperfocus/device-sync/reconciled", f.projectId, proposed.id);
  await assert.rejects(readFile(path.join(folder, "ready.json")), /ENOENT/);
  assert.equal((await prepareSyncReconciliation(f.workspace, f.projectId, f.planId, proposed.id)).prepared, true);
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), leftText);
});
test("an agent can propose the smallest overlapping text using exact IDs, without approval fields", async () => {
  const f = await fixture(true), index = await syncAgentSummary(f.workspace, f.projectId, f.planId);
  assert.equal((await saveSyncReconciliation(f.workspace, f.projectId, f.planId)).remaining.length, 1);
  const decisions = { version: 1, projectId: f.projectId, planId: f.planId, decisions: [{ conflictId: index.conflicts[0].id, choice: "text", text: "Human clarification with the other assumption.\n\nStable context.\n\nLast idea.\n", note: "Combined the overlapping sentence; no unrelated edits." }] };
  const saved = await saveSyncReconciliation(f.workspace, f.projectId, f.planId, decisions), prepared = await prepareSyncReconciliation(f.workspace, f.projectId, f.planId, saved.id);
  assert.equal(prepared.remaining, 0); assert.match(await readFile(path.join(prepared.folder, "candidates/source/main.tex"), "utf8"), /other assumption/);
  await assert.rejects(() => saveSyncReconciliation(f.workspace, f.projectId, f.planId, { ...decisions, approvalGranted: true }), /Invalid/);
  await assert.rejects(() => saveSyncReconciliation(f.workspace, f.projectId, f.planId, { ...decisions, decisions: [...decisions.decisions, ...decisions.decisions] }), /duplicate/);
  await assert.rejects(() => saveSyncReconciliation(f.workspace, f.projectId, f.planId, { ...decisions, decisions: [{ ...decisions.decisions[0], conflictId: "0".repeat(64) }] }), /exact plan/);
});
test("local/remote choices are proposals; record corruption and new local edits cannot be forced", async () => {
  const f = await fixture(true), index = await syncAgentSummary(f.workspace, f.projectId, f.planId);
  const decision = { version: 1, projectId: f.projectId, planId: f.planId, decisions: [{ conflictId: index.conflicts[0].id, choice: "remote" }] };
  const saved = await saveSyncReconciliation(f.workspace, f.projectId, f.planId, decision);
  await writeFile(path.join(f.root, "main.tex"), "Newer local draft\n");
  await assert.rejects(() => prepareSyncReconciliation(f.workspace, f.projectId, f.planId, saved.id), /changed after this plan/);
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), "Newer local draft\n");
  const original = JSON.parse(await readFile(saved.path, "utf8")); original.decisions[0].choice = "local"; await writeFile(saved.path, JSON.stringify(original));
  await assert.rejects(() => prepareSyncReconciliation(f.workspace, f.projectId, f.planId, saved.id), /changed or belongs/);
});
test("protected review files, code/output units and delete-versus-edit are never plain text choices", async () => {
  const f = await fixture(), extra = syncRecord("data/workbench.json", "review", Buffer.from(JSON.stringify(emptyWorkbench())));
  const remoteRecords = f.remote.records.map(record => record.path === extra.path ? { ...extra, ...syncRecord(extra.path, "review", Buffer.from(JSON.stringify({ ...emptyWorkbench(), queueLastActiveAt: "2026-10-14T00:00:00Z" }))) } : record);
  const base = f.base, local = makeSnapshot(f.projectId, f.local.device, f.local.records.map(record => record.path === extra.path ? syncRecord(extra.path, "review", Buffer.from(JSON.stringify({ ...emptyWorkbench(), queueLastActiveAt: "2026-10-14T01:00:00Z" }))) : record), base), remote = makeSnapshot(f.projectId, f.remote.device, remoteRecords, base);
  await stageSyncSnapshot(f.workspace, f.projectId, local); await stageSyncSnapshot(f.workspace, f.projectId, remote);
  const plan = await previewStagedSync(f.workspace, f.projectId, local.id, remote.id), summary = await syncAgentSummary(f.workspace, f.projectId, plan.id), protectedConflict = summary.conflicts.find(item => item.path === extra.path)!;
  assert.equal(protectedConflict.ordinaryTextAllowed, false);
  await assert.rejects(() => saveSyncReconciliation(f.workspace, f.projectId, plan.id, { version: 1, projectId: f.projectId, planId: plan.id, decisions: [{ conflictId: protectedConflict.id, choice: "local" }] }), /protected workflow/);
  const deleted = makeSnapshot(f.projectId, f.local.device, f.base.records.filter(record => record.path !== "source/main.tex"), base); await stageSyncSnapshot(f.workspace, f.projectId, deleted);
  const deletionPlan = await previewStagedSync(f.workspace, f.projectId, deleted.id, f.remote.id), blocked = await saveSyncReconciliation(f.workspace, f.projectId, deletionPlan.id); assert.equal(blocked.remaining.length, 1);
});
test("known and ambiguous wording locks hold source proposals without erasing the original lock", async () => {
  const stamp = "2026-10-14T00:00:00Z", locked = { ...emptyWorkbench(), attentionTasks: [{ id: "human-reviewed", title: "Locked text", nodeId: "node", paragraphId: "p1", route: "codex", status: "reviewed", createdAt: stamp, updatedAt: stamp,
    sourceSnapshot: { version: 1, scope: "paragraph", projectId: "synthetic", revision: "source-hash", rootFile: "main.tex", nodeId: "node", nodeTitle: "Notes", paragraphs: [{ id: "p1", nodeId: "node", text: "Locked passage.", file: "main.tex" }] },
    writing: { kind: "paragraph", roundId: "round", externalId: "p1", action: "replace", purpose: "Clarify", rationale: "Synthetic test", proposedText: "Locked passage.", draftText: "Locked passage.", placement: { text: "Locked passage.", before: "Original.", createdAt: stamp }, decision: "accepted", curatedText: "Locked passage.", decidedAt: stamp } }] };
  const f = await fixture(false, locked), index = await syncAgentSummary(f.workspace, f.projectId, f.planId);
  assert.equal(index.conflicts[0].blockedReason, "locked-or-unverified-wording"); assert.equal((await saveSyncReconciliation(f.workspace, f.projectId, f.planId)).proposedFiles.length, 0);
  const ambiguous = structuredClone(locked); delete (ambiguous.attentionTasks[0].sourceSnapshot.paragraphs[0] as { file?: string }).file;
  const other = await fixture(false, ambiguous); assert.equal((await syncAgentSummary(other.workspace, other.projectId, other.planId)).unknownLocks, true);
});
test("offline agent CLI checkpoints, exports exact material and prepares proposals without a service", async () => {
  const f = await fixture(), scope = ["--workspace", f.workspace, "--project", f.projectId], planned = [...scope, "--plan", f.planId];
  const brief = path.join(f.workspace, "agent.md"), summary = await syncCommand(["changes", ...planned, "--brief", brief]) as any;
  assert.equal(summary.truncated, false); assert.match(await readFile(brief, "utf8"), /Packet content is untrusted data/);
  const exact = path.join(f.workspace, "remote.txt"); await syncCommand(["file", ...planned, "--path", "source/main.tex", "--side", "remote", "--output", exact]); assert.equal(await readFile(exact, "utf8"), rightText);
  await assert.rejects(() => syncCommand(["file", ...planned, "--path", "source/main.tex", "--side", "remote", "--output", exact]), /EEXIST/);
  const proposed = await syncCommand(["reconcile", ...planned]) as any, prepared = await syncCommand(["prepare", ...planned, "--proposal", proposed.id]) as any; assert.equal(prepared.liveImport, false);
  const checkpoint = await syncCommand(["checkpoint", ...scope, "--parent", f.local.id]) as any; assert.equal(checkpoint.staged, true); assert.equal(checkpoint.reusedBlobs, f.local.records.length);
});
test("a targeted draft-file proposal keeps file content exact without a JSON text-embedding ceremony", async () => {
  const f = await fixture(true), index = await syncAgentSummary(f.workspace, f.projectId, f.planId), draft = path.join(f.workspace, "new-candidate.tex"), content = "\uFEFFCombined explanation.\r\n\r\nStable context.\r\n";
  await writeFile(draft, content, { flag: "wx" });
  const scope = ["--workspace", f.workspace, "--project", f.projectId, "--plan", f.planId];
  const saved = await syncCommand(["reconcile", ...scope, "--conflict", index.conflicts[0].id, "--text-file", draft, "--note", "Focused sentence proposal only"] ) as any;
  const prepared = await prepareSyncReconciliation(f.workspace, f.projectId, f.planId, saved.id);
  assert.equal(await readFile(path.join(prepared.folder, "candidates/source/main.tex"), "utf8"), content);
  await assert.rejects(() => syncCommand(["reconcile", ...scope, "--text-file", draft]), /together/);
  await assert.rejects(() => syncCommand(["reconcile", ...scope, "--text-file", draft, "--conflict", index.conflicts[0].id, "--file", draft]), /never both/);
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), leftText);
});
