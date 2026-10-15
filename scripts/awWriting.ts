/** Folder-aware writing handoff: inspect and submit proposals, never edit/approve source. */
import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AppState, ProjectDocument, WorkbenchStore } from "../src/types.ts";
import { receiveWritingReply, writingDecisions, writingLocks } from "../src/writing.ts";

export function writingHelp() {
  return `Active Writing — incremental manuscript assistance
node scripts/awWriting.ts inspect --workspace AW_HOME --project ID --task ROUND_ID [--url LOOPBACK]
node scripts/awWriting.ts submit SCOPE --revision WORKBENCH_REV --file PROPOSALS.json [--commit]
Inspect confirms ownership and returns the saved brief, locks, prior decisions and current revision.
Submit previews 0–3 connected paragraphs; --commit makes ONE guarded assistance-store save.
No manuscript writes, human approval, model calls, code execution or downloads. Preserve locked wording.
Use the returned revision; inspect conflicts instead of retrying automatically.
Alternatively finalize the saved request's response.json envelope. Do not use both delivery methods.
See docs/WRITING_WORKFLOW.md. Whole-paper context never means permission for a whole-paper draft.`;
}

export function writingOptions(argv: string[]) {
  const [command, ...args] = argv;
  if (command === "--help" || command === "help" || args.includes("--help")) return { command: "help", flags: {} as Record<string, string>, origin: "" };
  if (!["inspect", "submit"].includes(command)) throw new Error(writingHelp());
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !["workspace", "project", "task", "url", "revision", "file", "commit"].includes(key) || key in flags) throw new Error(`Unknown or repeated option ${args[i]}.`);
    if (key === "commit") flags[key] = "true";
    else { if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing --${key}.`); flags[key] = args[++i]; }
  }
  if (!["workspace", "project", "task"].every(k => flags[k])) throw new Error("Confirm --workspace, --project and --task; no selected project is inferred.");
  const url = new URL(flags.url ?? "http://127.0.0.1:4173");
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Use the local Aw origin only.");
  if (command === "inspect" && (flags.commit || flags.revision || flags.file)) throw new Error("Inspect is read-only; use submit for proposals.");
  if (command === "submit" && (!flags.file || !/^(0|[1-9]\d*)$/.test(flags.revision ?? ""))) throw new Error("Submit needs --file and the exact --revision from inspect.");
  return { command, flags, origin: url.origin };
}

export async function writingCommand(argv: string[], request: typeof fetch = fetch) {
  const { command, flags, origin } = writingOptions(argv);
  if (command === "help") return writingHelp();
  async function api(endpoint: string, data?: unknown) {
    const response = await request(`${origin}/api/paperfocus/${endpoint}`, { ...(data === undefined ? {} : { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(data) }), signal: AbortSignal.timeout(10000) });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? `Aw returned ${response.status}.`);
    return json;
  }
  const health = await api("health");
  if (health.app !== "active-writing" || path.resolve(health.workspaceRoot).toLowerCase() !== path.resolve(flags.workspace).toLowerCase()) throw new Error("Aw workspace differs from the confirmed home.");
  const query = new URLSearchParams({ projectId: flags.project });
  const store = await api(`workbench?${query}`) as WorkbenchStore;
  const task = store.attentionTasks.find(t => t.id === flags.task && t.writing?.kind === "request");
  if (!task || task.sourceSnapshot?.projectId !== flags.project) throw new Error("No writing request in this project's saved assistance store.");
  const document = await api(`document?${query}`) as ProjectDocument;
  if (document.project.id !== flags.project || document.project.mainFile !== task.sourceSnapshot.rootFile) throw new Error("This request belongs to another manuscript root. Do not change the project selection to guess it.");
  const locks = [...writingLocks(store.attentionTasks, document, {})].map(([paragraphId, t]) => ({ paragraphId, purpose: t.writing?.kind === "paragraph" ? t.writing.purpose : "", text: t.writing?.kind === "paragraph" ? t.writing.curatedText : "" }));
  if (command === "inspect") return { workspace: health.workspaceRoot, projectId: flags.project, paperRoot: path.resolve(health.workspaceRoot, document.project.folder), mainFile: document.project.mainFile, taskId: task.id, revision: store.revision, sourceRevision: document.revision, capturedSourceRevision: task.sourceSnapshot.revision,
    packet: task.packet, request: task.writing, status: task.status, previousDecisions: writingDecisions(store.attentionTasks, task.writing?.kind === "request" ? task.writing.previousRoundId : undefined), currentLocks: locks,
    paragraphs: store.attentionTasks.filter(t => t.writing?.kind === "paragraph" && t.writing.roundId === task.id).map(t => ({ id: t.id, writing: t.writing })),
    note: "The packet may contain unsaved human drafts. Locks are context, never rewrite targets. Submit proposals only; no source writes or human decisions." };
  if (store.revision !== Number(flags.revision)) throw new Error("Saved assistance changed. Inspect and reconcile; no write was made.");
  if (task.reply?.trim() || task.status === "reviewed") throw new Error("This round already has a reply or was closed. Preserve it and use a new human request.");
  const info = await lstat(flags.file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 160000) throw new Error("Use a bounded, regular proposal JSON file.");
  const reply = await readFile(flags.file, "utf8");
  if (Buffer.byteLength(reply) > 160000) throw new Error("The proposal file grew beyond its limit.");
  const state = { attentionTasks: store.attentionTasks } as AppState;
  const next = receiveWritingReply(state, task.id, reply);
  const updated = next.attentionTasks.find(t => t.id === task.id)!;
  if (updated.error || updated.status !== "ready") throw new Error(updated.error ?? "No proposals imported.");
  const proposals = next.attentionTasks.filter(t => t.writing?.kind === "paragraph" && t.writing.roundId === task.id);
  if (proposals.some(t => locks.some(l => l.paragraphId === t.paragraphId))) throw new Error("A target was locked since the request. Ask the human before proposing another edit.");
  if (!flags.commit) return { preview: true, revision: store.revision, proposals, writes: "none; add --commit for one guarded assistance save, never source edits" };
  const saved = await api("workbench", { projectId: flags.project, revision: store.revision, data: { ...store, attentionTasks: next.attentionTasks } });
  return { saved: true, projectId: flags.project, taskId: task.id, revision: saved.revision, paragraphTaskIds: proposals.map(t => t.id), note: "Proposed wording queued for the human. No manuscript text or approvals changed." };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await writingCommand(process.argv.slice(2)); console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2)); }
  catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
