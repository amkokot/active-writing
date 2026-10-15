import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { experimentEvidence, experimentEvidenceText, type EvidenceSnapshot } from "../src/experimentEvidence.ts";
import { ExperimentConflict, readExperiments } from "./experiments.ts";
import { readNotebook } from "./notebookStore.ts";
import { projectStorage } from "./projectStorage.ts";

const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const identifier = /^[A-Za-z0-9_-]{1,64}$/, digest = /^[a-f0-9]{64}$/;
async function noLink(target: string) {
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error("Evidence storage cannot use symbolic links or junctions."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function folder(workspace: string, projectId: string, notebookId: string, id: string) {
  if (!identifier.test(notebookId) || !digest.test(id)) throw new Error("Invalid evidence identity.");
  const { folder: root } = await projectStorage(workspace, projectId);
  const parts = ["experiments", notebookId, "evidence", id];
  let current = root;
  for (const part of parts) { current = path.join(current, part); await noLink(current); }
  for (const name of ["manifest.json", "evidence.ipynb", "evidence.md"]) await noLink(path.join(current, name));
  return current;
}
async function boundedRead(target: string, maxBytes: number) {
  await noLink(target);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error("Saved evidence is invalid or too large; files are preserved.");
  const data = await readFile(target);
  if (data.byteLength > maxBytes) throw new Error("Saved evidence changed while reading; files are preserved.");
  return data;
}
function ticket(folder: string, manifest: Omit<EvidenceSnapshot, "files"> & { hashes: { notebook: string; text: string } }): EvidenceSnapshot {
  const params = new URLSearchParams({ projectId: manifest.projectId, notebookId: manifest.notebookId, id: manifest.id });
  const file = (kind: "notebook" | "text", name: string) => ({ path: path.join(folder, name), filename: `aw-evidence-${manifest.notebookId}-${manifest.id.slice(0, 12)}.${kind === "notebook" ? "ipynb" : "md"}`, url: `/api/paperfocus/experiments/evidence/file?${params}&format=${kind}`, sha256: manifest.hashes[kind] });
  const { hashes: _hashes, ...info } = manifest;
  return { ...info, files: { notebook: file("notebook", "evidence.ipynb"), text: file("text", "evidence.md") } };
}
/** Downloads can read only one checked, completed snapshot, never arbitrary paths. */
export async function readEvidenceFile(workspace: string, projectId: string, notebookId: string, id: string, format: string) {
  if (!["notebook", "text"].includes(format)) throw new Error("Choose notebook or text evidence.");
  const target = await folder(workspace, projectId, notebookId, id);
  const manifest = JSON.parse((await boundedRead(path.join(target, "manifest.json"), 10_000)).toString("utf8"));
  if (manifest.version !== 1 || manifest.id !== id || manifest.projectId !== projectId || manifest.notebookId !== notebookId || !identifier.test(manifest.entryId) || !digest.test(manifest.revision) || manifest.id !== hash(JSON.stringify(["evidence-v1", projectId, manifest.entryId, notebookId, manifest.revision])) || !digest.test(manifest.hashes?.notebook) || !digest.test(manifest.hashes?.text) || !Number.isInteger(manifest.activeCells) || manifest.activeCells < 0 || manifest.activeCells > 200 || !Number.isInteger(manifest.excludedCells) || manifest.excludedCells < 0 || manifest.activeCells + manifest.excludedCells > 200 || typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("Evidence manifest does not match this notebook.");
  const result = ticket(target, manifest), file = result.files[format as "notebook" | "text"];
  const data = await boundedRead(file.path, format === "notebook" ? 5_000_000 : 8_000_000);
  if (hash(data) !== file.sha256) throw new Error("Saved evidence changed; not serving it as the original snapshot.");
  return { snapshot: result, data, filename: file.filename, mime: format === "notebook" ? "application/x-ipynb+json" : "text/markdown; charset=utf-8" };
}
const pending = new Map<string, Promise<EvidenceSnapshot>>();
export async function saveEvidenceSnapshot(workspace: string, projectId: string, entryId: string, notebookId: string, revision: string) {
  if (!identifier.test(entryId) || !identifier.test(notebookId) || !digest.test(revision)) throw new Error("Save a valid conversation and experiments before exporting evidence.");
  const conversations = await readNotebook(workspace, projectId);
  const entry = conversations.entries.find(entry => entry.id === entryId);
  if (!entry || (entry.experimentNotebookId ?? entry.id) !== notebookId) throw new Error("Evidence belongs to another conversation or notebook.");
  const store = await readExperiments(workspace, projectId, notebookId);
  if (store.revision !== revision) throw new ExperimentConflict("Experiments changed while preparing evidence. Prepare a fresh snapshot; your question is kept.");
  const id = hash(JSON.stringify(["evidence-v1", projectId, entryId, notebookId, revision]));
  const target = await folder(workspace, projectId, notebookId, id), key = target;
  if (pending.has(key)) return pending.get(key)!;
  const action = (async () => {
    try {
      const existing = await readEvidenceFile(workspace, projectId, notebookId, id, "notebook");
      await readEvidenceFile(workspace, projectId, notebookId, id, "text");
      return existing.snapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A committed manifest with a missing file is not an interrupted pre-commit export.
      try { await lstat(path.join(target, "manifest.json")); throw new Error("Saved evidence is incomplete; its files were preserved."); }
      catch (missing) { if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing; }
    }
    const evidence = experimentEvidence(store, { projectId, entryId, notebookId });
    const notebook = JSON.stringify(evidence.notebook, null, 2), text = experimentEvidenceText(evidence);
    if (Buffer.byteLength(notebook) > 5_000_000 || Buffer.byteLength(text) > 8_000_000) throw new Error("Complete evidence exceeds the portable file limit. Files are not shortened; export fewer active cells deliberately.");
    await mkdir(target, { recursive: true });
    // Recover an interrupted export only when the already-created file is identical.
    async function immutable(name: string, data: string, max: number) {
      const filename = path.join(target, name); await noLink(filename);
      try { await writeFile(filename, data, { encoding: "utf8", flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || (await boundedRead(filename, max)).toString("utf8") !== data) throw new Error("An evidence file already exists with different content; it was preserved."); }
    }
    await immutable("evidence.ipynb", notebook, 5_000_000);
    await immutable("evidence.md", text, 8_000_000);
    const manifest = { version: 1, id, projectId, entryId, notebookId, revision, createdAt: new Date().toISOString(), activeCells: evidence.activeCells, excludedCells: evidence.excludedCells, hashes: { notebook: hash(notebook), text: hash(text) } };
    await immutable("manifest.json", JSON.stringify(manifest, null, 2), 10_000);
    return (await readEvidenceFile(workspace, projectId, notebookId, id, "notebook")).snapshot;
  })();
  pending.set(key, action);
  try { return await action; } finally { if (pending.get(key) === action) pending.delete(key); }
}
