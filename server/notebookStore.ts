import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { NotebookEntry, NotebookStore } from "../src/types.ts";
import { projectStorage } from "./projectStorage.ts";
import { replaceFile } from "./atomicFile.ts";
import { withRecordLock } from "./recordLock.ts";
import { parseStudyAnswer, studyActions, studyGuidance } from "../src/study.ts";
import { validateSecondLook } from "../src/localReview.ts";
import { validateReturnAnchor } from "../src/sourceAnchors.ts";

async function noSymlink(target: string) {
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error("Notebook storage cannot use symbolic links."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function storage(workspace: string, projectId: string) {
  if (!projectId) throw new Error("Choose a paper for this notebook.");
  const { folder } = await projectStorage(workspace, projectId);
  const target = path.join(folder, "notebook.json");
  await noSymlink(folder); await noSymlink(target); await noSymlink(path.join(folder, "notebook.previous.json"));
  return { folder, target };
}
function validateQueueMetadata(value: any) {
  if (!value) return;
  if (value.queuePosition !== undefined && (!Number.isSafeInteger(value.queuePosition) || value.queuePosition < 0)) throw new Error("Invalid queue position.");
  for (const field of ["queueOrderedAt", "deferredAt", "queueColorResetAt", "queueHiddenAt"]) if (value[field] !== undefined && (typeof value[field] !== "string" || !Number.isFinite(Date.parse(value[field])))) throw new Error("Invalid queue timestamp.");
}
export function validateNotebookEntries(value: unknown): asserts value is NotebookEntry[] {
  if (!Array.isArray(value) || value.length > 2000 || JSON.stringify(value).length > 2_000_000) throw new Error("The notebook is too large or invalid.");
  const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry.id !== "string" || ids.has(entry.id)) throw new Error("Notebook entries need unique identifiers.");
    ids.add(entry.id);
    if (entry.manuscriptFile !== undefined && (typeof entry.manuscriptFile !== "string" || entry.manuscriptFile.length > 240 || !entry.manuscriptFile.endsWith(".tex") || /[\\:\x00-\x1f]/.test(entry.manuscriptFile) || entry.manuscriptFile.split("/").some((p: string) => !p || p === "." || p === ".."))) throw new Error("Invalid notebook manuscript.");
    if (entry.continuedFrom !== undefined && (!entry.continuedFrom || ["entryId", "notebookId", "manuscriptFile", "revision"].some(field => typeof entry.continuedFrom[field] !== "string" || entry.continuedFrom[field].length > 240))) throw new Error("Invalid notebook continuation.");
    if (entry.pinned !== undefined && typeof entry.pinned !== "boolean") throw new Error("Invalid notebook pin.");
    if (entry.pinMode !== undefined && !["conversation", "experiments"].includes(entry.pinMode)) throw new Error("Invalid notebook pin display.");
    if(entry.filed!==undefined && typeof entry.filed!=="boolean")throw new Error("Invalid notebook filing state.");
    if(entry.folder!==undefined && (typeof entry.folder!=="string" || entry.folder.length>100 || /[\r\n]/.test(entry.folder)))throw new Error("Invalid notebook folder name.");
    if(entry.cataloguePosition!==undefined && (!Number.isSafeInteger(entry.cataloguePosition) || entry.cataloguePosition<0 || entry.cataloguePosition>=2000))throw new Error("Invalid notebook order.");
    if (entry.experimentNotebookId !== undefined && (typeof entry.experimentNotebookId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.experimentNotebookId))) throw new Error("Invalid experiment owner.");
    if (entry.recoveryKey !== undefined && (typeof entry.recoveryKey !== "string" || entry.recoveryKey.length > 500)) throw new Error("Invalid recovery identity.");
    if (entry.experimentContext !== undefined && (typeof entry.experimentContext !== "string" || entry.experimentContext.length > 6000)) throw new Error("Invalid experiment context.");
    for (const field of ["title", "question", "notes", "reply", "proposal", "createdAt", "updatedAt"]) if (typeof entry[field] !== "string") throw new Error(`Invalid notebook ${field}.`);
    if (!["open", "parked", "integrated"].includes(entry.status) || !["local", "chatgpt", "codex"].includes(entry.route)
      || !Number.isInteger(entry.effort) || entry.effort < 0 || entry.effort > 4 || !Array.isArray(entry.handoffs) || !Array.isArray(entry.appliedChanges)) throw new Error("Invalid notebook state.");
    for (const packet of entry.handoffs) { validateQueueMetadata(packet); if (typeof packet.id !== "string" || typeof packet.packet !== "string" || typeof packet.createdAt !== "string" || packet.historyOnly !== undefined && typeof packet.historyOnly !== "boolean") throw new Error("Invalid saved handoff."); }
    for (const change of entry.appliedChanges) if (typeof change.before !== "string" || typeof change.after !== "string" || typeof change.createdAt !== "string") throw new Error("Invalid proposal history.");
    if (entry.study !== undefined) {
      const study = entry.study;
      const focusValid = (focus: unknown) => focus === undefined || Boolean(focus && typeof (focus as { text?: unknown }).text === "string" && typeof (focus as { origin?: unknown }).origin === "string");
      if (!study || !["understand", "develop"].includes(study.mode) || !["intuition", "example", "derivation"].includes(study.depth) || !Object.hasOwn(studyActions, study.action)
        || typeof study.background !== "string" || !Number.isInteger(study.localEffort) || study.localEffort < 0 || study.localEffort > 3 || !Array.isArray(study.turns) || study.turns.length > 200 || !focusValid(study.focus)) throw new Error("Invalid approach learning workspace.");
      if (study.guidance !== undefined && !Object.hasOwn(studyGuidance, study.guidance)) throw new Error("Invalid learning help level.");
      if (study.secondLook !== undefined && typeof study.secondLook !== "boolean") throw new Error("Invalid second look setting.");
      if (study.evidenceScope !== undefined && !["compact", "expanded"].includes(study.evidenceScope)) throw new Error("Invalid experiment context setting.");
      if (study.handoff !== undefined && (!study.handoff || !["paste", "files"].includes(study.handoff.transport) || !["continuation", "briefing"].includes(study.handoff.contextMode) || typeof study.handoff.label !== "string" || study.handoff.label.length > 100)) throw new Error("Invalid external handoff settings.");
      if ((study.delivery !== undefined && !["integrated", "manual"].includes(study.delivery)) || ["remoteModel", "remoteEffort"].some((field) => study[field] !== undefined && typeof study[field] !== "string")) throw new Error("Invalid subscription choice.");
      if (study.benchmark !== undefined) {
        const b = study.benchmark;
        if (!b || !["attempt", "compare"].includes(b.phase) || ["statement", "citationKey", "locator", "referenceNotes"].some((field) => typeof b[field] !== "string")
          || (b.checkpoint !== undefined && (!b.checkpoint || ["statement", "question", "notes", "findings", "createdAt"].some((field) => typeof b.checkpoint[field] !== "string")))) throw new Error("Invalid known-result comparison.");
      }
      const turns = new Set<string>();
      for (const turn of study.turns) {
        validateQueueMetadata(turn);
        if (!turn || typeof turn.id !== "string" || turns.has(turn.id) || !Object.hasOwn(studyActions, turn.action) || !["intuition", "example", "derivation"].includes(turn.depth)
          || !["local", "chatgpt", "codex"].includes(turn.route) || !["queued", "ready", "failed"].includes(turn.status) || !focusValid(turn.focus)
          || ["packet", "reply", "createdAt"].some((field) => typeof turn[field] !== "string") || (turn.answer !== undefined && !parseStudyAnswer(JSON.stringify(turn.answer)))
          || ["model", "jobId", "subscriptionJobId", "reasoningEffort", "partialReply", "error"].some((field) => turn[field] !== undefined && typeof turn[field] !== "string") || (turn.closed !== undefined && typeof turn.closed !== "boolean") || (turn.completedExternally !== undefined && typeof turn.completedExternally !== "boolean")
          || (turn.effort !== undefined && (!Number.isInteger(turn.effort) || turn.effort < 0 || turn.effort > (turn.route === "local" ? 3 : 4)))) throw new Error("Invalid retained explanation.");
        if (turn.guidance !== undefined && !Object.hasOwn(studyGuidance, turn.guidance)) throw new Error("Invalid retained help level.");
        if (turn.secondLookRequested !== undefined && typeof turn.secondLookRequested !== "boolean") throw new Error("Invalid requested second look.");
        if (turn.secondLook !== undefined) validateSecondLook(turn.secondLook);
        if (turn.notebookResult !== undefined) {
          const result = turn.notebookResult;
          if (!result || !/^[a-f0-9]{64}$/.test(result.requestHash) || !/^[a-f0-9]{64}$/.test(result.notebookRevision)
            || !/^[A-Za-z0-9_-]{1,64}$/.test(result.summaryCellId) || typeof result.completedAt !== "string" || !Number.isFinite(Date.parse(result.completedAt))) throw new Error("Invalid direct notebook completion.");
        }
        if (turn.previousTurnId !== undefined && (typeof turn.previousTurnId !== "string" || !turns.has(turn.previousTurnId))) throw new Error("Invalid earlier explanation link.");
        if (turn.handoffSnapshot !== undefined && typeof turn.handoffSnapshot !== "string") throw new Error("Invalid handoff snapshot.");
        if (turn.ticket !== undefined && (!turn.ticket || !["paste", "files"].includes(turn.ticket.transport) || ["id", "label", "promptPath", "responsePath", "requestHash", "copyText"].some((field) => typeof turn.ticket[field] !== "string") || (turn.ticket.replyHash !== undefined && typeof turn.ticket.replyHash !== "string"))) throw new Error("Invalid retained handoff ticket.");
        if (turn.ticket?.notebookTarget && (turn.ticket.transport !== "files" || [turn.ticket.notebookTarget.entryId, turn.ticket.notebookTarget.notebookId].some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)))) throw new Error("Invalid direct notebook destination.");
        turns.add(turn.id);
      }
      if ((study.localModel !== undefined && typeof study.localModel !== "string") || (study.activeTurnId !== undefined && (typeof study.activeTurnId !== "string" || !turns.has(study.activeTurnId)))) throw new Error("Invalid explanation selection.");
    }
    if (entry.source) {
      if (entry.source.passages !== undefined && (!Array.isArray(entry.source.passages) || entry.source.passages.length < 2 || entry.source.passages.length > 200)) throw new Error("Invalid selected notebook blocks.");
      for (const source of [entry.source, ...(entry.source.passages ?? [])]) {
      for (const field of ["paragraphId", "nodeId", "nodeTitle", "revision", "paragraphText", "excerpt"]) if (typeof source[field] !== "string") throw new Error("Invalid source link.");
      if (source.duplicateAtCapture !== undefined && typeof source.duplicateAtCapture !== "boolean") throw new Error("Invalid source repetition flag.");
      if (source.returnAnchor !== undefined) validateReturnAnchor(source.returnAnchor);
      if (!Number.isInteger(source.start) || !Number.isInteger(source.end) || source.start < 0 || source.end < source.start
        || source.end > source.paragraphText.length || source.paragraphText.slice(source.start, source.end) !== source.excerpt) throw new Error("Invalid excerpt range.");
      if (source !== entry.source && source.passages !== undefined) throw new Error("Nested selections are unsupported.");
      }
      if (entry.source.passages) {
        const first = entry.source.passages[0];
        for (const field of ["paragraphId", "nodeId", "revision", "paragraphText", "excerpt", "start", "end", "file"]) if (first[field] !== entry.source[field]) throw new Error("The selected blocks need a matching first source link.");
        const ranges = new Map<string, Array<{ start: number; end: number }>>();
        for (const source of entry.source.passages) {
          if (!source.excerpt.trim() || source.end <= source.start || (source.file !== undefined && typeof source.file !== "string")) throw new Error("Invalid selected source block.");
          const previous = ranges.get(source.paragraphId) ?? [];
          if (previous.some(p => source.start < p.end && source.end > p.start)) throw new Error("Selected source blocks overlap.");
          previous.push(source); ranges.set(source.paragraphId, previous);
        }
      }
    }
  }
}
export async function readNotebook(workspace: string, projectId: string): Promise<NotebookStore> {
  const { target } = await storage(workspace, projectId);
  try {
    const stored = JSON.parse(await readFile(target, "utf8"));
    if (stored.version !== 1 || !Number.isInteger(stored.revision)) throw new Error("Unrecognized notebook format; the file has been preserved.");
    validateNotebookEntries(stored.entries);
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, revision: 0, entries: [] };
    throw error;
  }
}
const pendingWrites = new Map<string, Promise<void>>();
export function writeNotebook(workspace: string, projectId: string, revision: number, entries: unknown, expectedHash?: string): Promise<NotebookStore> {
  if (expectedHash !== undefined && (typeof expectedHash !== "string" || expectedHash !== "" && !/^[a-f0-9]{64}$/.test(expectedHash))) throw new Error("Use an exact catalogue hash, or empty for a missing file.");
  const key = `${path.resolve(workspace)}:${projectId}`;
  const operation = (pendingWrites.get(key) ?? Promise.resolve()).then(() => writeNotebookNow(workspace, projectId, revision, entries, expectedHash));
  const tail = operation.then(() => undefined, () => undefined);
  pendingWrites.set(key, tail);
  void tail.then(() => { if (pendingWrites.get(key) === tail) pendingWrites.delete(key); });
  return operation;
}
async function writeNotebookNow(workspace: string, projectId: string, revision: number, entries: unknown, expectedHash?: string): Promise<NotebookStore> {
  validateNotebookEntries(entries);
  const { folder, target } = await storage(workspace, projectId);
  await mkdir(folder, { recursive: true });
  return withRecordLock(target, async () => {
  const checkHash = async () => {
    if (expectedHash === undefined) return;
    await noSymlink(target);
    let current = "";
    try {
      const stat = await lstat(target); if (!stat.isFile() || stat.size > 24 * 1024 * 1024) throw new Error("Invalid or oversized catalogue; preserved.");
      current = createHash("sha256").update(await readFile(target)).digest("hex");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current !== expectedHash) throw new Error("Catalogue bytes changed. Reinspect; no source or notes were replaced.");
  };
  await checkHash();
  const previous = await readNotebook(workspace, projectId);
  if (previous.revision !== revision) throw new Error("The notebook changed in another window. Your draft is kept; reload to recover it.");
  await mkdir(folder, { recursive: true });
  const result: NotebookStore = { ...previous, version: 1, revision: revision + 1, entries };
  const temporary = path.join(folder, `notebook-${randomUUID()}.tmp`);
  // Keep one previous version as well as the browser's immediate recovery draft.
  if (previous.revision) await writeFile(path.join(folder, "notebook.previous.json"), JSON.stringify(previous, null, 2), "utf8");
  await writeFile(temporary, JSON.stringify(result, null, 2), { encoding: "utf8", flag: "wx" });
  if ((await readNotebook(workspace, projectId)).revision !== revision) throw new Error("The notebook changed during saving; draft preserved. Reinspect and reconcile.");
  await checkHash();
  await replaceFile(temporary, target);
  return result;
  });
}
