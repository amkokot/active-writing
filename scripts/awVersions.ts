/** Scoped chronology and guarded version creation. Never runs cells/models. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { manuscriptPurpose, manuscriptWritingPolicy, nextManuscriptVersion } from "../src/manuscripts.ts";
import type { NotebookStore, ProjectDocument } from "../src/types.ts";

export function versionsHelp() {
  return `Active Writing — manuscript versions
node scripts/awVersions.ts inspect --workspace AW_HOME --project ID [--url LOOPBACK]
node scripts/awVersions.ts create --workspace AW_HOME --project ID --root MAIN.tex --revision SOURCE_HASH --notebook-revision NUMBER --file NEW.tex [--fresh] [--commit]
node scripts/awVersions.ts purpose --workspace AW_HOME --project ID --root MAIN.tex --revision SOURCE_HASH --expected-purpose notes|overview|publication --purpose notes|overview|publication [--target MAIN.tex --expected-target MAIN.tex|none] [--commit]
node scripts/awVersions.ts transfer --workspace AW_HOME --project ID --root MAIN.tex --revision SOURCE_HASH --notebook-revision NUMBER --entries ID,ID --target OTHER.tex --mode move|copy [--commit]
Transfer previews first. Moves retain experiment identity; copies preserve independent saved evidence. Passage links stay at their real source. Finish waiting requests and save drafts first. No code runs or source changes.
Purpose previews by default; commit changes Aw metadata only. Set purpose only at the human's direction, never to evade a publication review. Notes allow full-length explanations within authorized scope; overview stays short and collaborator-facing; publication uses small reviewed steps. Existing locks/reviews are never cleared.
Create previews by default. --commit copies TeX and saved notebooks, then selects the new root project-wide.
Continue is default; --fresh starts an empty notebook for this version. Save browser drafts first.
Pending requests stay in the old version. No code reruns, cloud calls, flattening, deletion, approval or publication.
Inspect conflicts/prepared copies before retrying. See docs/AGENT_GUIDE.md, Manuscript versions.`;
}
export function versionsOptions(argv: string[]) {
  const [command, ...args] = argv;
  if (["--help", "help"].includes(command) || args.includes("--help")) return { command: "help", flags: {} as Record<string, string>, origin: "" };
  if (!["inspect", "create", "purpose", "transfer"].includes(command)) throw new Error(versionsHelp());
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !["workspace", "project", "url", "root", "revision", "notebook-revision", "file", "fresh", "commit", "purpose", "expected-purpose", "entries", "target", "mode", "expected-target"].includes(key) || key in flags) throw new Error(`Unknown/repeated option ${args[i]}.`);
    if (["fresh", "commit"].includes(key)) flags[key] = "true";
    else { if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing --${key}.`); flags[key] = args[++i]; }
  }
  if (!flags.workspace || !flags.project) throw new Error("Confirm --workspace and --project; no active paper is inferred.");
  const url = new URL(flags.url ?? "http://127.0.0.1:4173");
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Use the loopback Aw origin only.");
  if (command === "inspect" && Object.keys(flags).some(k => !["workspace", "project", "url"].includes(k))) throw new Error("Inspect is read-only.");
  if (command === "create" && (!flags.root || !flags.file || !/^[a-f0-9]{64}$/.test(flags.revision ?? "") || !/^(0|[1-9]\d*)$/.test(flags["notebook-revision"] ?? ""))) throw new Error("Create needs --root, --file and both exact revisions from inspect.");
  if (command === "create" && (flags.purpose || flags["expected-purpose"])) throw new Error("New versions inherit purpose. Change it explicitly with purpose.");
  if (command === "create" && (flags.entries || flags.target || flags.mode || flags["expected-target"])) throw new Error("Conversation selection belongs to transfer, not version creation.");
  if (command === "purpose" && (Object.keys(flags).some(k => !["workspace", "project", "url", "root", "revision", "purpose", "expected-purpose", "target", "expected-target", "commit"].includes(k)) || !flags.root || !/^[a-f0-9]{64}$/.test(flags.revision ?? "") || !["notes", "overview", "publication"].includes(flags.purpose) || !["notes", "overview", "publication"].includes(flags["expected-purpose"]))) throw new Error("Purpose needs an exact root/revision, --purpose and --expected-purpose; no version/cell options.");
  if (command === "transfer" && (Object.keys(flags).some(k => !["workspace", "project", "url", "root", "revision", "notebook-revision", "entries", "target", "mode", "commit"].includes(k)) || !flags.root || !flags.target || !flags.entries || !["move", "copy"].includes(flags.mode) || !/^[a-f0-9]{64}$/.test(flags.revision ?? "") || !/^(0|[1-9]\d*)$/.test(flags["notebook-revision"] ?? ""))) throw new Error("Transfer needs exact revisions, --entries ID,ID, --target and --mode move|copy.");
  if (command === "purpose" && ((flags.target && (flags.purpose !== "overview" || !flags["expected-target"])) || (flags["expected-target"] && !flags.target))) throw new Error("Overview link editing needs --target ROOT.tex|none and --expected-target ROOT.tex|none.");
  return { command, flags, origin: url.origin };
}
export async function versionsCommand(argv: string[], request: typeof fetch = fetch) {
  const { command, flags, origin } = versionsOptions(argv);
  if (command === "help") return versionsHelp();
  async function api(endpoint: string, data?: unknown) {
    const response = await request(`${origin}/api/paperfocus/${endpoint}`, { ...(data === undefined ? {} : { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(data) }), signal: AbortSignal.timeout(30000) });
    const json = await response.json(); if (!response.ok) throw new Error(json.error ?? `Aw returned ${response.status}.`); return json;
  }
  const health = await api("health");
  const same = (a: string, b: string) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
  if (health.app !== "active-writing" || !same(health.workspaceRoot, flags.workspace)) throw new Error("Aw home differs from the confirmed workspace.");
  const query = new URLSearchParams({ projectId: flags.project });
  const document = await api(`document?${query}`) as ProjectDocument, notebook = await api(`notebook?${query}`) as NotebookStore;
  if (document.project.id !== flags.project) throw new Error("The returned paper identity differs.");
  if (command === "inspect") return { workspace: health.workspaceRoot, projectId: flags.project, paperRoot: path.resolve(health.workspaceRoot, document.project.folder), mainFile: document.project.mainFile,
    sourceRevision: document.revision, notebookRevision: notebook.revision, purpose: manuscriptPurpose(document.project), purposes: document.project.manuscriptPurposes ?? {}, overviewTargets: document.project.manuscriptOverviewTargets ?? {}, purposeSupported: !!health.features?.manuscriptPurpose, versions: document.project.manuscriptVersions ?? [], roots: document.rootFiles, suggested: nextManuscriptVersion(document.project),
    writingPolicy: manuscriptWritingPolicy(manuscriptPurpose(document.project)), transferSupported: !!health.features?.notebookTransfer, conversations: notebook.entries.map(e => ({ id: e.id, title: e.title, notebookId: e.experimentNotebookId ?? e.id, manuscriptFile: e.manuscriptFile, continuedFrom: e.continuedFrom })), supported: !!health.features?.manuscriptVersions };
  if (command === "purpose") {
    if (!health.features?.manuscriptPurpose) throw new Error("The running Aw service needs its writing-purpose update. Do not restart an occupied service.");
    if (flags.root !== document.project.mainFile || flags.revision !== document.revision || flags["expected-purpose"] !== manuscriptPurpose(document.project)) throw new Error("The root, source or purpose changed. Inspect before retrying.");
    const purpose = flags.purpose as "notes" | "overview" | "publication";
    if ((purpose === "overview" || flags.target) && !health.features?.collaboratorOverview) throw new Error("The running service needs the collaborator-overview update; do not restart an occupied service.");
    if (!flags.commit) return { preview: true, projectId: flags.project, root: flags.root, before: manuscriptPurpose(document.project), purpose, targetFile: flags.target === "none" ? "" : flags.target, policy: manuscriptWritingPolicy(purpose), sourceWrites: false };
    return api("manuscripts/purpose", { projectId: flags.project, mainFile: flags.root, file: flags.root, revision: flags.revision, purpose, expectedPurpose: flags["expected-purpose"], ...(flags.target ? { targetFile: flags.target === "none" ? "" : flags.target, expectedTarget: flags["expected-target"] === "none" ? "" : flags["expected-target"] } : {}) });
  }
  if (command === "transfer") {
    if (!health.features?.notebookTransfer) throw new Error("The running Aw service needs the notebook-transfer update; do not restart an occupied service.");
    if (flags.root !== document.project.mainFile || flags.revision !== document.revision || Number(flags["notebook-revision"]) !== notebook.revision) throw new Error("Saved scope changed. Inspect before retrying.");
    return api("notebook/transfer", { projectId: flags.project, mainFile: flags.root, revision: flags.revision, notebookRevision: notebook.revision, entryIds: flags.entries.split(","), targetFile: flags.target, mode: flags.mode, preview: !flags.commit });
  }
  if (!health.features?.manuscriptVersions) throw new Error("The running Aw service needs its versioning update. Do not restart an occupied service.");
  if (flags.root !== document.project.mainFile || flags.revision !== document.revision || Number(flags["notebook-revision"]) !== notebook.revision) throw new Error("The root or saved revisions changed. Inspect and reconcile before retrying.");
  return api("manuscripts/version", { projectId: flags.project, mainFile: flags.root, revision: flags.revision, notebookRevision: notebook.revision, file: flags.file,
    notebook: flags.fresh ? "fresh" : "continue", preview: !flags.commit });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  versionsCommand(process.argv.slice(2)).then(result => console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
