/** Folder-aware client phase rollover. Never rewrites the old notebook or executes code. */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { newExperimentCell, newExperimentNotebook, type ExperimentStore } from "../src/experiments.ts";
import type { NotebookEntry } from "../src/types.ts";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const samePath = (a: string, b: string) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
// Walk every component: realpath alone would conceal a symlink/junction inside Aw data.
async function safePath(root: string, target: string, create = false) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Phase path escapes Aw data.");
  if (!samePath(await realpath(root), root)) throw new Error("Aw data is redirected; inspect its actual location first.");
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create) await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(current);
    if (info.isSymbolicLink() || !samePath(await realpath(current), current)) throw new Error("Phase paths must not be symlinks or junctions.");
  }
}
async function immutableFile(file: string, data: string | Buffer) {
  try { await writeFile(file, data, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await lstat(file)).isSymbolicLink() || hash(await readFile(file)) !== hash(data)) throw new Error(`Phase backup differs: ${file}. Preserve it and inspect before retrying.`);
  }
}

export async function researchPhase(input: {
  flags: Record<string, string>; origin: string; workspace: string;
  entry: NotebookEntry; conversations: { revision: number; entries: NotebookEntry[] };
  store: ExperimentStore & { runtime?: { activeJobs?: Array<{ projectId: string; notebookId: string }> } };
  request: (endpoint: string, body?: unknown) => Promise<any>;
}) {
  const { flags, origin, workspace, entry, conversations, store, request } = input;
  const notebookId = entry.experimentNotebookId ?? entry.id;
  const folders = await request(`workspace-folders?${new URLSearchParams({ projectId: flags.project })}`);
  const root: string = folders.data?.path;
  if (!root) throw new Error("This project has no returned Aw data folder.");
  if ((await stat(path.resolve(flags.file))).size > 80_000) throw new Error("Use a short handoff, not copied experiment outputs.");
  const source = await readFile(path.resolve(flags.file), "utf8");
  if (!source.trim() || source.length > 20_000 || Buffer.byteLength(source) > 80_000) throw new Error("Use a nonempty handoff of at most 20,000 characters / 80,000 bytes, not copied experiment outputs.");
  const title = flags.title.trim();
  if (!title || title.length > 200 || /[\r\n]/.test(title)) throw new Error("Use a single-line phase title of at most 200 characters.");
  const folder = flags.folder ?? "Earlier research";
  if (!folder.trim() || folder.length > 100 || /[\r\n]/.test(folder)) throw new Error("Use a single-line archive folder of at most 100 characters.");
  const revision = flags.revision === "missing" ? "" : flags.revision;
  const operationId = hash(JSON.stringify({ workspace: path.resolve(workspace), project: flags.project, entry: entry.id, notebookId, revision, title, folder, handoffHash: hash(source) }));
  const nextId = `phase-${operationId.slice(0, 32)}`;
  const backup = path.join(root, "research", "phases", operationId);
  const link = (id: string) => `${origin}/?${new URLSearchParams({ awProject: flags.project, awPanel: "notebook", awNotebook: id, awFormat: "reading" })}`;
  const plan = { operationId, workspace, projectId: flags.project, paperRoot: folders.paper.path, previousEntryId: entry.id, previousNotebookId: notebookId, previousRevision: revision || "missing", entryId: nextId, notebookId: nextId, title, folder, backupPath: backup, previousUrl: link(entry.id), url: link(nextId), executed: false, manuscriptChanged: false };
  const existing = conversations.entries.find(item => item.id === nextId);
  // Completion retries are read-only, including after the human has restored the archive.
  if (existing) {
    const next = await request(`experiments?${new URLSearchParams({ projectId: flags.project, notebookId: nextId })}`);
    if (existing.experimentNotebookId !== nextId || next.notebook.metadata.awResearchPhase?.operationId !== operationId) throw new Error("Phase identity is already occupied by different work.");
    await safePath(root, backup);
    for (const name of ["manifest.json", "notebook.ipynb", "conversation.json"]) await safePath(root, path.join(backup, name));
    const manifest = JSON.parse(await readFile(path.join(backup, "manifest.json"), "utf8"));
    if (manifest.operationId !== operationId || hash(await readFile(path.join(backup, "notebook.ipynb"))) !== manifest.notebookHash || hash(await readFile(path.join(backup, "conversation.json"))) !== manifest.conversationHash) throw new Error("Phase backup is damaged. Preserve it and inspect.");
    return { ...plan, committed: true, reused: true, revision: next.revision };
  }
  if (store.revision !== revision) throw new Error("Notebook changed. Reinspect before starting a phase.");
  if (conversations.entries.filter(item => (item.experimentNotebookId ?? item.id) === notebookId).length !== 1) throw new Error("Notebook has multiple conversation owners. Organize them explicitly rather than filing one alias.");
  if (entry.filed) throw new Error("Start a phase from an active conversation, not an already filed archive.");
  if (entry.study?.turns.some(turn => !turn.closed && ["queued", "working"].includes(turn.status))) throw new Error("This conversation has pending research. Finish or explicitly park it before rollover.");
  if (store.runtime?.activeJobs?.some(job => job.projectId === flags.project && job.notebookId === notebookId)) throw new Error("This notebook has a running job. Wait for its saved result before rollover.");
  if (!flags.commit) return { ...plan, committed: false, handoff: source, note: "Read-only plan. With archival permission repeat identical arguments plus --commit. Save browser drafts first; no code will run." };

  const expectedPath = path.join(root, "experiments", notebookId, "notebook.ipynb");
  if (!samePath(expectedPath, store.path)) throw new Error("Unexpected notebook path. No changes made.");
  let bytes: Buffer = Buffer.from(JSON.stringify(store.notebook, null, 2));
  if (revision) { await safePath(root, store.path); bytes = await readFile(store.path); if (hash(bytes) !== revision) throw new Error("Notebook changed before backup. Reinspect."); }
  await safePath(root, backup, true);
  const conversation = JSON.stringify(entry, null, 2);
  // A fixed manifest makes interrupted retries recognizable, without copying current research again.
  const manifest = { version: 1, ...plan, handoffHash: hash(source), notebookHash: hash(bytes), conversationHash: hash(conversation), originalNotebookMissing: !revision };
  await immutableFile(path.join(backup, "notebook.ipynb"), bytes);
  await immutableFile(path.join(backup, "conversation.json"), conversation);
  await immutableFile(path.join(backup, "manifest.json"), JSON.stringify(manifest, null, 2));
  const notebook = newExperimentNotebook();
  notebook.metadata.awResearchPhase = { version: 1, operationId, previousEntryId: entry.id, previousNotebookId: notebookId, previousRevision: revision, backupPath: backup };
  const handoff = newExperimentCell("markdown"); handoff.id = "phase-handoff"; handoff.source = source;
  handoff.metadata.paperfocus = { title: "Current research checkpoint", pinned: true, highlighted: true };
  const provenance = newExperimentCell("markdown"); provenance.id = "phase-history";
  provenance.source = `## Research phase history\n\n[Previous phase: ${entry.title.replace(/[\[\]]/g, "")} ](${link(entry.id)})\n\nOriginal notebook owner: \`${notebookId}\`; revision: \`${revision || "missing"}\`.\n\nFull fixed backup (including filed/trashed cells): \`${backup}\`. The manifest records SHA-256 hashes. The original notebook, cell IDs, outputs and run folders were not rewritten. This handoff is a summary, not new proof verification or execution. Restore the old conversation to read it; do not merge owners. Manuscripts are unchanged.`;
  notebook.cells = [handoff, provenance];
  const target = await request(`experiments?${new URLSearchParams({ projectId: flags.project, notebookId: nextId })}`);
  let saved = target;
  if (!target.revision) saved = await request("experiments", { projectId: flags.project, notebookId: nextId, revision: "", notebook });
  else if (JSON.stringify(target.notebook) !== JSON.stringify(notebook)) throw new Error("An interrupted phase's fresh notebook was edited. Preserve it; do not overwrite on retry.");
  const current = await request(`experiments?${new URLSearchParams({ projectId: flags.project, notebookId })}`);
  if (current.revision !== revision || current.runtime?.activeJobs?.some((job: any) => job.projectId === flags.project && job.notebookId === notebookId)) throw new Error("Old notebook changed or started running. Archive untouched; prepared fresh notebook and backups retained for inspection.");
  const now = new Date().toISOString();
  const next: NotebookEntry = { id: nextId, experimentNotebookId: nextId, manuscriptFile: entry.manuscriptFile, title, question: title, notes: `Research phase checkpoint; previous phase: ${link(entry.id)}\nFixed backup: ${backup}`, reply: "", proposal: "", pinned: true, pinMode: "experiments", status: "open", route: entry.route, effort: entry.effort, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now };
  await request("notebook", { projectId: flags.project, revision: conversations.revision, entries: [...conversations.entries.map(item => item.id === entry.id ? { ...item, filed: true, folder, updatedAt: now } : item), next] });
  return { ...plan, committed: true, reused: false, revision: saved.revision, note: "Old ownership and evidence preserved. Continue with the returned entryId; no experiments were rerun." };
}
