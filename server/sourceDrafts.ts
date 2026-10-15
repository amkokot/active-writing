import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceDraftCopy } from "../src/sourceRefresh.ts";
import { projectStorage } from "./projectStorage.ts";
import { replaceFile } from "./atomicFile.ts";

const maxBytes = 1_000_000;
const copyName = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;
async function guard(target: string) {
  try { const info = await lstat(target); if (info.isSymbolicLink()) throw new Error("Draft copies cannot use symbolic links or junctions."); return info; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function folderFor(workspace: string, projectId: string) {
  if (!projectId) throw new Error("Choose a paper for draft recovery.");
  const { folder: sidecar } = await projectStorage(workspace, projectId); const folder = path.join(sidecar, "source-drafts");
  await guard(sidecar); await guard(folder);
  return folder;
}
export function validateSourceDraftCopy(value: unknown): asserts value is SourceDraftCopy {
  const copy = value as SourceDraftCopy;
  if (!copy || copy.version !== 1 || typeof copy !== "object") throw new Error("Invalid source draft copy.");
  for (const key of ["projectId", "rootFile", "baseRevision", "incomingRevision"] as const) if (typeof copy[key] !== "string" || !copy[key] || copy[key].length > 2000) throw new Error("Invalid source draft metadata.");
  if (!Array.isArray(copy.drafts) || !copy.drafts.length || copy.drafts.length > 500) throw new Error("Invalid source drafts.");
  const ids = new Set<string>();
  for (const draft of copy.drafts) {
    if (!draft || typeof draft !== "object" || typeof draft.paragraphId !== "string" || !draft.paragraphId || draft.paragraphId.length > 2000 || ids.has(draft.paragraphId)) throw new Error("Invalid source draft identity.");
    ids.add(draft.paragraphId);
    if (!["changed", "missing", "ambiguous", "unknown-base"].includes(draft.reason)) throw new Error("Invalid source draft reason.");
    for (const key of ["file", "baseText", "draftText"] as const) if (draft[key] !== undefined && (typeof draft[key] !== "string" || draft[key]!.length > maxBytes)) throw new Error("Invalid source draft text.");
    if (typeof draft.draftText !== "string") throw new Error("The source draft text is missing.");
  }
  if (Buffer.byteLength(JSON.stringify(copy)) > maxBytes) throw new Error("Draft recovery is too large; keep the editor open and copy your drafts before refreshing.");
}
export async function saveSourceDraftCopy(workspace: string, projectId: string, data: unknown) {
  validateSourceDraftCopy(data);
  if (data.projectId !== projectId) throw new Error("The source draft belongs to another paper.");
  const folder = await folderFor(workspace, projectId);
  const copy: SourceDraftCopy = { version: 1, id: randomUUID(), createdAt: new Date().toISOString(), projectId,
    rootFile: data.rootFile, baseRevision: data.baseRevision, incomingRevision: data.incomingRevision,
    drafts: data.drafts.map(({ paragraphId, file, baseText, draftText, reason }) => ({ paragraphId, file, baseText, draftText, reason })) };
  await mkdir(folder, { recursive: true });
  const target = path.join(folder, `${copy.id}.json`); const temporary = path.join(folder, `${copy.id}.tmp`);
  await writeFile(temporary, JSON.stringify(copy), { encoding: "utf8", flag: "wx" });
  await replaceFile(temporary, target);
  return copy;
}
export async function readSourceDraftCopies(workspace: string, projectId: string) {
  const folder = await folderFor(workspace, projectId);
  if (!(await guard(folder))) return [];
  const entries = await readdir(folder);
  const names = entries.filter((name) => copyName.test(name));
  const dated = await Promise.all(names.map(async (name) => ({ name, info: await guard(path.join(folder, name)) })));
  const copies: SourceDraftCopy[] = []; let bytes = 0;
  for (const entry of dated.sort((a, b) => (b.info?.mtimeMs ?? 0) - (a.info?.mtimeMs ?? 0)).slice(0, 20)) {
    if (!entry.info?.isFile() || entry.info.size > maxBytes) throw new Error("A source draft copy is invalid or oversized; it has been preserved.");
    // Return the newest copies up to 2 MB. Older files remain on disk, never pruned.
    if (bytes + entry.info.size > 2_000_000) break;
    const raw = await readFile(path.join(folder, entry.name), "utf8");
    const copy = JSON.parse(raw); validateSourceDraftCopy(copy);
    if (copy.projectId !== projectId || `${copy.id}.json` !== entry.name || typeof copy.createdAt !== "string") throw new Error("A source draft copy has invalid metadata; it has been preserved.");
    if (bytes + Buffer.byteLength(raw) > 2_000_000) break;
    copies.push(copy); bytes += Buffer.byteLength(raw);
  }
  return copies;
}
