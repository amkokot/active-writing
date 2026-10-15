import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { WorkbenchData, WorkbenchStore } from "../src/types.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { projectStorage } from "./projectStorage.ts";
import { replaceFile } from "./atomicFile.ts";
import { sourceSnapshotLimits } from "../src/taskSource.ts";
import { validateReturnAnchor } from "../src/sourceAnchors.ts";
import { validateWritingTask } from "../src/writing.ts";

const maxBytes = 4_000_000;
function object(value: unknown): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved work record.");
}
function text(value: unknown, limit = 100_000) {
  if (typeof value !== "string" || value.length > limit) throw new Error("Invalid or oversized saved text.");
}
function strings(value: Record<string, any>, fields: string[], optional = false) {
  for (const field of fields) if (!optional || value[field] !== undefined) text(value[field]);
}
function choice(value: unknown, values: Array<string | number>) {
  if (!values.includes(value as string)) throw new Error("Invalid saved work setting.");
}
function boolean(value: unknown) {
  if (value !== undefined && typeof value !== "boolean") throw new Error("Invalid saved work flag.");
}
function task(value: unknown) {
  object(value);
  strings(value, ["id", "title", "nodeId", "createdAt", "updatedAt"]);
  if (!value.id || value.notebookId !== undefined || value.studyTurnId !== undefined) throw new Error("Notebook tasks belong in the Notebook store.");
  strings(value, ["sessionId", "previousTaskId", "handoffPath", "packet", "reply", "replyDraft", "localJobId", "subscriptionJobId", "error", "paragraphId"], true);
  choice(value.route, ["local", "chatgpt", "codex"]);
  choice(value.status, ["queued", "working", "ready", "failed", "reviewed"]);
  if (value.queuePosition !== undefined && (!Number.isSafeInteger(value.queuePosition) || value.queuePosition < 0)) throw new Error("Invalid queue position.");
  for (const field of ["queueOrderedAt", "deferredAt", "queueColorResetAt", "queueHiddenAt"]) if (value[field] !== undefined && (typeof value[field] !== "string" || !Number.isFinite(Date.parse(value[field])))) throw new Error("Invalid queue timestamp.");
  if (value.archivedStatus !== undefined) choice(value.archivedStatus, ["queued", "working", "ready", "failed"]);
  boolean(value.authorEditedReply); boolean(value.turbo); boolean(value.completedExternally);
  validateWritingTask(value as unknown as import("../src/types.ts").AttentionTask);
  if (value.sourceSnapshot !== undefined) {
    const source = value.sourceSnapshot; object(source); choice(source.version, [1]); choice(source.scope, ["paragraph", "section"]);
    strings(source, ["projectId", "revision", "rootFile", "nodeId", "nodeTitle"]); strings(source, ["focusParagraphId"], true);
    boolean(source.locationUnverified);
    if (source.returnAnchor !== undefined) validateReturnAnchor(source.returnAnchor);
    if (source.unavailableReason !== undefined) choice(source.unavailableReason, ["oversized"]);
    unique(source.paragraphs, (paragraph) => { object(paragraph); strings(paragraph, ["id", "nodeId", "text"]); strings(paragraph, ["file", "nodeTitle"], true); boolean(paragraph.locationUnverified); boolean(paragraph.duplicateAtCapture);
      if (paragraph.command !== undefined) {
        choice(paragraph.command, ["opening", "closing"]);
        if (paragraph.id !== `aw-command:${paragraph.nodeId}:${paragraph.command}` || source.scope !== "paragraph" || source.paragraphs.length !== 1 || value.review?.kind !== "comment") throw new Error("Invalid command comment source.");
      }
      if (paragraph.nodeParagraphCount !== undefined && (!Number.isSafeInteger(paragraph.nodeParagraphCount) || paragraph.nodeParagraphCount < 1)) throw new Error("Invalid source structure count.");
    }, sourceSnapshotLimits.paragraphs);
    if (source.paragraphs.reduce((size: number, p: { text: string }) => size + p.text.length, 0) > sourceSnapshotLimits.characters || source.unavailableReason && source.paragraphs.length) throw new Error("Invalid or oversized source snapshot.");
  }
  if (value.ticket !== undefined) {
    object(value.ticket); choice(value.ticket.transport, ["paste", "files"]);
    strings(value.ticket, ["id", "label", "promptPath", "responsePath", "requestHash", "copyText"]);
    strings(value.ticket, ["replyHash"], true);
  }
  if (value.reminder !== undefined) {
    const reminder = value.reminder; object(reminder); choice(reminder.kind, ["passage", "section"]);
    if (!value.sourceSnapshot || value.sourceSnapshot.unavailableReason || value.review || value.ticket || value.localJobId || value.sessionId || value.subscriptionJobId
      || value.route !== "local" || !["queued", "reviewed"].includes(value.status) || value.archivedStatus && value.archivedStatus !== "queued") throw new Error("Invalid saved reminder.");
    if (reminder.kind === "passage") {
      text(reminder.quote, 12000);
      boolean(reminder.wholeBlock);
      const source = value.sourceSnapshot.paragraphs.find((p: any) => p.id === value.paragraphId);
      if (!source || value.sourceSnapshot.paragraphs.length !== 1 || !reminder.quote.trim() || !Number.isSafeInteger(reminder.start) || !Number.isSafeInteger(reminder.end)
        || reminder.start < 0 || reminder.end <= reminder.start || source.text.slice(reminder.start, reminder.end) !== reminder.quote || reminder.end > source.text.length
        || reminder.wholeBlock && (reminder.start !== 0 || reminder.end !== source.text.length)) throw new Error("Invalid bookmark range.");
    } else if (value.paragraphId || value.sourceSnapshot.paragraphs.length || value.sourceSnapshot.nodeId !== value.nodeId) throw new Error("Invalid section reminder.");
  }
  if (value.review !== undefined) {
    const review = value.review; object(review); choice(review.kind, ["comment", "request"]);
    if (!value.sourceSnapshot || value.sourceSnapshot.unavailableReason) throw new Error("Review tasks need their saved source.");
    if (review.kind === "comment") {
      choice(review.author, ["human", "assistant"]); text(review.body, 6000); text(review.quote, 12000);
      strings(review, ["resolvedAt", "batchId", "externalId", "replyTo"], true); boolean(review.editedByHuman);
      const source = value.sourceSnapshot.paragraphs.find((p: any) => p.id === value.paragraphId);
      if (!source || value.sourceSnapshot.paragraphs.length !== 1 || !Number.isInteger(review.start) || !Number.isInteger(review.end) || review.start < 0 || review.end <= review.start || review.end > source.text.length || source.text.slice(review.start, review.end) !== review.quote
        || !["queued", "reviewed"].includes(value.status) || (value.status === "reviewed") !== Boolean(review.resolvedAt) || value.ticket || value.localJobId || value.sessionId || value.subscriptionJobId) throw new Error("Invalid review comment anchor or resolution.");
    } else {
      choice(review.mode, ["human", "ai"]); text(review.instructions, 6000); strings(review, ["instructionsPath", "webPath", "completedPath"], true);
      if (!Array.isArray(review.commentIds) || review.commentIds.length > 100 || review.commentIds.some((id: unknown) => typeof id !== "string") || new Set(review.commentIds).size !== review.commentIds.length) throw new Error("Invalid review comment IDs.");
    }
  }
}
function rewrite(value: unknown) {
  object(value);
  strings(value, ["id", "paragraphId", "nodeId", "sourceText", "sourceFingerprint", "beforeAnchor", "afterAnchor", "instruction", "createdAt", "updatedAt"]);
  strings(value, ["localModel", "selectedCandidateId"], true);
  if (value.selectionSpans !== undefined) {
    if (!Array.isArray(value.selectionSpans) || value.selectionSpans.length < 2 || value.selectionSpans.length > 200) throw new Error("Invalid selected rewrite blocks.");
    const ranges = new Map<string, any[]>();
    for (const span of value.selectionSpans) {
      object(span); strings(span, ["paragraphId", "nodeId", "text"]);
      if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start || span.text.length !== span.end - span.start) throw new Error("Invalid selected rewrite range.");
      const previous = ranges.get(span.paragraphId) ?? [];
      if (previous.some(s => span.start < s.end && span.end > s.start)) throw new Error("Overlapping rewrite blocks.");
      previous.push(span); ranges.set(span.paragraphId, previous);
    }
    if (value.sourceText !== value.selectionSpans.map(s => s.text).join("\n\n") || value.paragraphId !== value.selectionSpans[0].paragraphId || value.start !== value.selectionSpans[0].start || value.end !== value.selectionSpans[0].end) throw new Error("Selected rewrite text does not match its blocks.");
  }
  if (!value.id || !Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 0 || value.end < value.start) throw new Error("Invalid saved rewrite range.");
  choice(value.route, ["rules", "local", "chatgpt", "codex"]); choice(value.status, ["draft", "stale", "applied", "archived"]);
  object(value.effortByRoute);
  for (const route of ["rules", "local", "chatgpt", "codex"]) choice(value.effortByRoute[route], [0, 1, 2, 3, 4]);
  unique(value.candidates, (candidate) => {
    object(candidate); strings(candidate, ["id", "text", "source"]);
    if (typeof candidate.dismissed !== "boolean" || typeof candidate.userEdited !== "boolean") throw new Error("Invalid saved candidate flags.");
  }, 500);
  if (value.selectedCandidateId !== undefined && !value.candidates.some((c: { id: string }) => c.id === value.selectedCandidateId)) throw new Error("The saved candidate selection is missing.");
}
function handoff(value: unknown) {
  object(value); choice(value.effort, [0, 1, 2, 3, 4]); choice(value.scope, ["paragraph", "section", "none", "auto"]);
  if (typeof value.includeProject !== "boolean") throw new Error("Invalid saved handoff scope.");
  strings(value, ["instruction"]); strings(value, ["label", "previousTaskId"], true);
  if (value.contextMode !== undefined) choice(value.contextMode, ["continuation", "briefing"]);
}
function unique(value: unknown, validate: (record: unknown) => void, maximum = 2000) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Too many saved work records.");
  const ids = new Set<string>();
  for (const record of value) {
    object(record); text(record.id, 1000);
    if (!record.id || ids.has(record.id)) throw new Error("Saved work records need unique identifiers.");
    ids.add(record.id); validate(record);
  }
}
export function validateWorkbench(value: unknown): asserts value is WorkbenchData {
  object(value);
  if (value.queueLastActiveAt !== undefined && (typeof value.queueLastActiveAt !== "string" || !Number.isFinite(Date.parse(value.queueLastActiveAt)))) throw new Error("Invalid project activity timestamp.");
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes - 100) throw new Error("Saved work exceeds the 4 MB limit. All drafts have been retained in the browser.");
  unique(value.attentionTasks, task); unique(value.rewriteSessions, rewrite); object(value.handoffDrafts);
  if (Object.keys(value.handoffDrafts).length > 2000) throw new Error("Too many saved handoff drafts.");
  for (const [key, draft] of Object.entries(value.handoffDrafts)) {
    text(key, 1000); if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid draft identifier."); handoff(draft);
  }
  unique(value.recoveredDrafts, (draft) => {
    object(draft); strings(draft, ["key", "createdAt"]); boolean(draft.dismissed);
    choice(draft.kind, ["task", "rewrite", "handoff"]);
    ({ task, rewrite, handoff } as Record<string, (value: unknown) => void>)[draft.kind](draft.value);
  });
}
async function guarded(target: string) {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error("Saved work cannot use symbolic links or junctions.");
    return info;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function storage(workspace: string, projectId: string) {
  if (!projectId) throw new Error("Choose a paper for saved work.");
  const { folder } = await projectStorage(workspace, projectId);
  const target = path.join(folder, "workbench.json"); const backup = path.join(folder, "workbench.previous.json");
  await guarded(folder); await guarded(target); await guarded(backup);
  return { folder, target, backup };
}
export async function readWorkbench(workspace: string, projectId: string): Promise<WorkbenchStore> {
  const { target } = await storage(workspace, projectId);
  try {
    const info = await guarded(target);
    if (!info) return { version: 1, revision: 0, ...emptyWorkbench() };
    if (!info.isFile() || info.size > maxBytes) throw new Error("The saved work file is invalid or too large; it has been preserved.");
    const raw = await readFile(target, "utf8");
    if (Buffer.byteLength(raw) > maxBytes) throw new Error("The saved work file is too large; it has been preserved.");
    const stored = JSON.parse(raw);
    if (stored?.version !== 1 || !Number.isSafeInteger(stored.revision) || stored.revision < 0) throw new Error("Unrecognized saved work format; the file has been preserved.");
    validateWorkbench(stored);
    return stored as WorkbenchStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, revision: 0, ...emptyWorkbench() };
    throw error;
  }
}
export class WorkbenchConflict extends Error {}
const writes = new Map<string, Promise<void>>();
export function writeWorkbench(workspace: string, projectId: string, revision: number, data: unknown): Promise<WorkbenchStore> {
  const key = `${path.resolve(workspace)}:${projectId}`;
  const operation = (writes.get(key) ?? Promise.resolve()).then(async () => {
    validateWorkbench(data);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid saved work revision.");
    const { folder, target, backup } = await storage(workspace, projectId);
    const previous = await readWorkbench(workspace, projectId);
    if (previous.revision !== revision) throw new WorkbenchConflict("Saved work changed in another window. Reload before saving.");
    await mkdir(folder, { recursive: true });
    // Whitelist the stored shape; incoming records cannot replace the version or revision.
    const result: WorkbenchStore = { version: 1, revision: revision + 1, ...(data.queueLastActiveAt ? { queueLastActiveAt: data.queueLastActiveAt } : {}), attentionTasks: data.attentionTasks,
      rewriteSessions: data.rewriteSessions, handoffDrafts: data.handoffDrafts, recoveredDrafts: data.recoveredDrafts };
    if (previous.revision) {
      const temporaryBackup = path.join(folder, `workbench-backup-${randomUUID()}.tmp`);
      await writeFile(temporaryBackup, JSON.stringify(previous), { encoding: "utf8", flag: "wx" });
      await replaceFile(temporaryBackup, backup);
    }
    const temporary = path.join(folder, `workbench-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(result), { encoding: "utf8", flag: "wx" });
    await replaceFile(temporary, target);
    return result;
  });
  const tail = operation.then(() => undefined, () => undefined); writes.set(key, tail);
  void tail.then(() => { if (writes.get(key) === tail) writes.delete(key); });
  return operation;
}
