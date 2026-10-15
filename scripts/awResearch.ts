/** Agent-facing records CLI, with explicit offline disk access. No model calls or server startup. */
import { readFile, stat } from "node:fs/promises";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cellText, experimentContext, experimentStaleness, newExperimentCell } from "../src/experiments.ts";
import { experimentRunBudget, checkExperimentBudgetRuntime } from "../src/experimentLimits.ts";
import { arrangeExperimentCell, savedOutputLabel, type CellArrangement } from "../src/experimentActions.ts";
import { researchPhase } from "../server/researchPhase.ts";
import { agentJson, createAgentJson, samePath, agentManifest, manifestChanges, prepareAgentBatch } from "./awAgentState.ts";
import { checkExperimentInputs } from "../server/experimentInputs.ts";
import { validateExperimentInputs } from "../src/experimentInputs.ts";
import { replyOutline } from "../src/replyOutline.ts";
import { manuscriptPurpose, manuscriptWritingPolicy } from "../src/manuscripts.ts";
import { offlineResearchRequest } from "./awOffline.ts";

const commands = ["inspect", "discover", "bind", "manifest", "batch", "inputs", "preflight", "cell", "output", "put", "organize", "finish", "run", "job", "session", "restart", "evidence", "phase"];
export function researchHelp(command?: string) {
  return `Active Writing — folder-aware research commands (no downloads or model calls)
Run with node scripts/awResearch.ts COMMAND. No tsx/npx installation is needed.
Scope: --workspace AW_HOME --project PROJECT_ID --entry CONVERSATION_ID [--url LOOPBACK_ORIGIN]
or --scope BINDING.json. A binding is explicit identity, never execution permission.
Add --offline for server-independent discover/bind/inspect/cell/output/inputs/manifest/put/batch/organize/finish/run/job.
Offline mode uses guarded disk stores, never HTTP or an automatic fallback.
run --offline --allow-python executes one saved trusted cell in fresh Python, waits, saves outputs/provenance and returns the new revision.
job --offline reads an immutable saved run; no waiting, shared session, rerun or live capacity claims.
${command ? `Help for ${command}:\n` : ""}discover --workspace AW_HOME [--project ID]: list project identities or conversation titles, not private notes.
bind SCOPE --file NEW.json: create an explicit binding; existing files are never overwritten.
inspect SCOPE [--expanded] [--since MANIFEST.json]: catalogue/current revision or only changed cells.
manifest SCOPE [--file NEW.json]: hash index for later --since; not evidence or a claim of reading.
cell SCOPE --cell ID / output SCOPE --cell ID --output INDEX: complete saved evidence.
put SCOPE --cell ID --revision REV --file SOURCE [--kind markdown|code|raw] [--title TITLE] [--after ID] [--inputs INPUTS.json]
batch SCOPE --revision REV --file EDITS.json [--commit]: preview, then one guarded save for 1–50 edits. Never executes.
  EDITS: {version:1,changes:[{cell:"note",source:"...",kind:"markdown",title:"...",arrange:{pinned:true}}]}
  Optional file paths are relative to EDITS.json. Existing outputs/metadata are retained.
inputs SCOPE --cell ID: check declared files against the saved run's hashes, without execution.
run SCOPE --cell ID --revision REV --allow-python [--session] [--timeout-seconds 30|120|300]: requires human permission.
job SCOPE --job ID [--wait-seconds 1..60]: wait/read without rerunning. Working at timeout is not failure.
organize, preflight, session, restart, evidence, finish and phase retain their documented options.
Use returned revisions, not repeated inspect after each successful save. Conflicts require reconciliation.
Batch/manifest/binding work offline or on the existing service. Live input capture requires features.experimentInputs;
never restart an occupied service to enable it. See docs/RESEARCH_WORKFLOW.md for full contracts.`;
}

export function researchOptions(argv: string[]): { command: string; flags: Record<string, string>; origin: string; expectedOwner?: string } {
  const [command, ...args] = argv;
  if (command === "help" || command === "--help" || commands.includes(command) && args.includes("--help")) return { command: "help", flags: { topic: commands.includes(command) ? command : "" }, origin: "" };
  if (!commands.includes(command)) throw new Error("Use node scripts/awResearch.ts --help for commands. See docs/RESEARCH_WORKFLOW.md.");
  const flags: Record<string, string> = {};
  const allowed = new Set(["offline", "scope", "since", "inputs", "wait-seconds", "url", "workspace", "project", "entry", "cell", "revision", "file", "kind", "title", "after", "before", "pin", "highlight", "suppress", "filed", "trash", "folder", "output", "task", "request-hash", "summary-cell", "job", "allow-python", "session", "expanded", "timeout-seconds", "commit"]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !allowed.has(key) || key in flags) throw new Error(`Unknown or repeated option: ${args[i]}`);
    if (["offline", "allow-python", "session", "expanded", "commit"].includes(key)) flags[key] = "true";
    else { if (args[i + 1] === undefined || args[i + 1].startsWith("--")) throw new Error(`Missing --${key} value.`); flags[key] = args[++i]; }
  }
  let expectedOwner: string | undefined;
  if (flags.scope) {
    const info = lstatSync(flags.scope);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 10_000) throw new Error("Use a bounded regular Aw binding file.");
    const scope = JSON.parse(readFileSync(flags.scope, "utf8"));
    if (scope?.version !== 1 || scope.type !== "aw-agent-scope" || ["origin", "workspace", "projectId", "entryId", "notebookId"].some(key => typeof scope[key] !== "string" || !scope[key])) throw new Error("Invalid Aw binding; explicit scope is required.");
    for (const [key, field] of [["url", "origin"], ["workspace", "workspace"], ["project", "projectId"], ["entry", "entryId"]]) {
      if (flags[key] && !(key === "workspace" ? samePath(flags[key], scope[field]) : flags[key] === scope[field])) throw new Error("Binding and explicit scope differ; no project is silently selected.");
      flags[key] = scope[field];
    }
    expectedOwner = scope.notebookId;
  }
  for (const name of command === "discover" ? ["workspace"] : ["workspace", "project", "entry"]) if (!flags[name]) throw new Error(`Explicit --${name} is required; never assume the selected paper.`);
  if (command === "discover" && flags.entry && !flags.project) throw new Error("A conversation needs an explicit project.");
  if (flags.session && command !== "run") throw new Error("--session applies only to run.");
  if (flags["timeout-seconds"] !== undefined && command !== "run") throw new Error("--timeout-seconds applies only to run.");
  const commandFlags: Record<string, string[]> = {
    discover: [], bind: ["file"], manifest: ["file"], batch: ["file", "revision", "commit"], inputs: ["cell"],
    inspect: ["expanded", "since"], cell: ["cell"], output: ["cell", "output"], put: ["cell", "file", "revision", "kind", "title", "after", "inputs"],
    organize: ["cell", "revision", "before", "after", "pin", "highlight", "suppress", "filed", "trash", "folder", "output"],
    finish: ["task", "request-hash", "summary-cell", "revision"], run: ["cell", "revision", "allow-python", "session", "timeout-seconds"],
    job: ["job", "wait-seconds"], evidence: ["revision"], phase: ["revision", "title", "file", "folder", "commit"], session: [], restart: [], preflight: [],
  };
  for (const name of Object.keys(flags)) if (!["offline", "scope", "url", "workspace", "project", "entry", ...commandFlags[command]].includes(name)) throw new Error(`--${name} does not apply to ${command}; no option is silently ignored.`);
  const url = new URL(flags.url || "http://127.0.0.1:4173");
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Use the app's HTTP loopback origin, not a remote URL.");
  if (["cell", "output", "put", "organize", "run", "inputs"].includes(command) && !/^[A-Za-z0-9_-]{1,64}$/.test(flags.cell || "")) throw new Error("Provide a valid --cell ID.");
  if (["put", "organize", "finish", "run", "evidence", "phase", "batch"].includes(command) && flags.revision === undefined) throw new Error("Use the exact --revision from inspect (missing for a new notebook). Reinspect after a conflict.");
  if (["batch", "bind"].includes(command) && !flags.file) throw new Error("Provide --file for this command.");
  if (command === "phase" && (!flags.title || !flags.file)) throw new Error("Provide --title and --file containing a short Markdown handoff. phase plans by default; --commit requires archival permission.");
  if (command === "finish" && (!/^[0-9a-f-]{36}$/i.test(flags.task || "") || !/^[a-f0-9]{64}$/.test(flags["request-hash"] || "") || !/^[A-Za-z0-9_-]{1,64}$/.test(flags["summary-cell"] || ""))) throw new Error("Use --task ID --request-hash HASH --summary-cell ID from this saved request and notebook.");
  const arrangements = ["pin", "highlight", "suppress", "filed", "trash", "folder", "before"];
  for (const name of arrangements) if (flags[name] !== undefined && command !== "organize" && !(command === "phase" && name === "folder")) throw new Error(`--${name} applies only to organize.`);
  for (const name of ["pin", "highlight", "suppress", "filed", "trash"]) if (flags[name] !== undefined && !["true", "false"].includes(flags[name])) throw new Error(`Use --${name} true or false.`);
  if (flags.output !== undefined && !["organize", "output"].includes(command)) throw new Error("--output applies to output or organize.");
  if (command === "output" && !/^\d{1,2}$/.test(flags.output ?? "")) throw new Error("Provide --output INDEX, zero-based, from inspect.");
  if (command === "organize" && ![...arrangements, "after", "output"].some(name => flags[name] !== undefined)) throw new Error("Choose a cell arrangement to change.");
  if (flags.before && flags.after) throw new Error("Choose --before or --after, not both.");
  if (command === "put" && !flags.file) throw new Error("Provide --file containing the cell's source text, not a whole notebook.");
  if (command === "run" && flags["allow-python"] !== "true") throw new Error("--allow-python requires the human's permission for trusted bounded code. This is not a sandbox.");
  if (command === "job" && !/^[A-Za-z0-9_-]{1,64}$/.test(flags.job || "")) throw new Error("Provide --job from the run response.");
  if (flags.expanded && command !== "inspect") throw new Error("--expanded applies only to inspect.");
  if (flags["timeout-seconds"] !== undefined) {
    if (!["30", "120", "300"].includes(flags["timeout-seconds"])) throw new Error("Use --timeout-seconds 30, 120 or 300.");
    experimentRunBudget(Number(flags["timeout-seconds"]) * 1000);
  }
  if (flags["wait-seconds"] !== undefined && (!/^\d{1,2}$/.test(flags["wait-seconds"]) || Number(flags["wait-seconds"]) < 1 || Number(flags["wait-seconds"]) > 60)) throw new Error("Use --wait-seconds 1..60; this never queues or reruns code.");
  return { command, flags, origin: url.origin, expectedOwner };
}

export async function researchCommand(argv: string[]) {
  const { command, flags, origin, expectedOwner } = researchOptions(argv);
  if (command === "help") return researchHelp(flags.topic);
  const request = flags.offline ? await offlineResearchRequest(command, flags, expectedOwner) : async (endpoint: string, body?: unknown) => {
    const response = await fetch(`${origin}/api/paperfocus/${endpoint}`, {
      redirect: "error", signal: AbortSignal.timeout(10_000),
      ...(body === undefined ? {} : { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${data.error || "Aw request failed"}`);
    return data;
  };
  const health = await request("health");
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (health.app !== "active-writing" || normalize(health.workspaceRoot) !== normalize(flags.workspace)) throw new Error("Wrong Aw workspace. No changes made.");
  const projectId = flags.project;
  if (["cell", "output"].includes(command) && health.features?.researchCells === true) {
    const params = new URLSearchParams({ projectId, entryId: flags.entry, cellId: flags.cell });
    if (command === "output") params.set("output", flags.output);
    if (expectedOwner) params.set("owner", expectedOwner);
    return request(`research/cell?${params}`);
  }
  if (command === "discover" && !projectId) {
    const registry = await request("projects");
    return { workspace: health.workspaceRoot, projects: registry.projects.map(({ id, name, folder, mainFile }: any) => ({ id, name, folder, mainFile })), note: "Read-only identities. Choose a project explicitly; no current selection changed." };
  }
  const conversations = await request(`notebook?${new URLSearchParams({ projectId })}`);
  if (command === "discover") return { workspace: health.workspaceRoot, projectId, entries: conversations.entries.filter((entry: any) => !flags.entry || entry.id === flags.entry).map((entry: any) => ({ id: entry.id, title: entry.title, notebookId: entry.experimentNotebookId ?? entry.id, filed: Boolean(entry.filed), updatedAt: entry.updatedAt })) };
  const entry = conversations.entries.find((item: { id: string }) => item.id === flags.entry);
  if (!entry) throw new Error("Conversation not found in this paper. No changes made.");
  const notebookId = entry.experimentNotebookId ?? entry.id;
  if (expectedOwner && expectedOwner !== notebookId) throw new Error("Bound notebook ownership changed. Confirm the new owner and create a new binding; no writes or execution started.");
  if (command === "preflight") return request("research/preflight", { projectId, entryId: entry.id });
  if (command === "bind") {
    const scope = { version: 1, type: "aw-agent-scope", origin, workspace: health.workspaceRoot, projectId, entryId: entry.id, notebookId };
    return { ...scope, file: await createAgentJson(flags.file, health.workspaceRoot, scope), note: "Explicit identity only, not permission to execute or edit manuscripts." };
  }
  const params = new URLSearchParams({ projectId, notebookId });
  if (command === "job") {
    const until = Date.now() + Number(flags["wait-seconds"] ?? 0) * 1000;
    let job = await request(`experiments/job?${params}&id=${encodeURIComponent(flags.job)}`);
    while (job.status === "working" && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, until - Date.now())));
      job = await request(`experiments/job?${params}&id=${encodeURIComponent(flags.job)}`);
    }
    return job;
  }
  if (command === "session") return request(`experiments/session?${params}`);
  if (command === "restart") return request("experiments/restart-session", { projectId, notebookId });
  const store = await request(`experiments?${params}`);
  const identity = { workspace: health.workspaceRoot, ...(health.codeRoot ? { codeRoot: health.codeRoot } : {}), projectId, entryId: entry.id, notebookId, path: store.path, revision: store.revision || "missing", ...(flags.offline ? { offline: true } : {}) };
  let folders: any;
  const inputCache = { hashes: new Map(), totalBytes: 0 }, checks = new Map<string, any>();
  const inputCheck = async (cell: any) => {
    if (checks.has(cell.id)) return checks.get(cell.id);
    const inputs = cell.metadata.paperfocus?.execution?.inputs;
    if (!inputs?.length) return undefined;
    folders ??= await request(`workspace-folders?${new URLSearchParams({ projectId })}`);
    const result = await checkExperimentInputs({ paper: folders.paper.path, data: folders.data.path }, inputs, inputCache);
    checks.set(cell.id, result); return result;
  };
  const readManifest = async () => {
    for (const cell of store.notebook.cells) await inputCheck(cell);
    return agentManifest(identity, origin, store.notebook, new Map([...checks].map(([id, check]) => [id, check.changed])));
  };
  if (command === "manifest") { const manifest = await readManifest(); return flags.file ? { ...identity, file: await createAgentJson(flags.file, health.workspaceRoot, manifest), cells: manifest.cells.length, note: manifest.note } : manifest; }
  if (command === "phase") return researchPhase({ flags, origin, workspace: health.workspaceRoot, entry, conversations, store, request });
  if (command === "inspect") {
    folders = await request(`workspace-folders?${new URLSearchParams({ projectId })}`);
    const manuscriptFile = entry.manuscriptFile ?? entry.source?.rootFile ?? folders.paper.mainFile;
    const purpose = manuscriptPurpose(folders.paper, manuscriptFile);
    const changes = flags.since ? manifestChanges(await agentJson(flags.since, 100_000), await readManifest()) : undefined;
    const selected = changes ? store.notebook.cells.filter((cell: any) => changes.changed.some(item => item.id === cell.id)) : store.notebook.cells;
    const cells = [];
    for (const cell of selected) {
      const inputs = await inputCheck(cell), staleReason = experimentStaleness(cell, store.notebook) ?? (inputs?.changed.length ? "declared input files changed since execution" : undefined);
      const link = new URL(origin); for (const [key, value] of Object.entries({ awProject: projectId, awPanel: "notebook", awNotebook: entry.id, awCell: cell.id, awEvidence: store.revision, awFormat: "reading" })) link.searchParams.set(key, value as string);
      cells.push({ id: cell.id, title: cell.metadata.paperfocus?.title, kind: cell.cell_type,
        flags: Object.fromEntries(Object.entries(cell.metadata.paperfocus ?? {}).filter(([key]) => key !== "lastRunSource")),
        stale: Boolean(staleReason), staleReason, inputCheck: inputs, link: link.href,
        headings: cell.cell_type === "markdown" ? replyOutline(cellText(cell)).sections.slice(0,8).map(section => section.title) : undefined,
        outputs: (cell.outputs ?? []).map((output: any, index: number) => ({ index, label: savedOutputLabel(output, index), type: output.output_type, mime: Object.keys(output.data ?? {}) })),
      });
    }
    return {
      ...identity, paperRoot: folders.paper.path, awDataRoot: folders.data?.path,
      manuscriptFile, mainManuscript: folders.paper.manuscriptOverviewTargets?.[manuscriptFile], manuscriptPurpose: purpose, writingPolicy: manuscriptWritingPolicy(purpose),
      question: entry.question, notes: entry.notes, runtime: store.runtime,
      phase: store.notebook.metadata.awResearchPhase,
      storage: await notebookStorage(store),
      requests: (entry.study?.turns ?? []).filter((turn: any) => turn.ticket?.notebookTarget).map((turn: any) => ({ taskId: turn.id, requestHash: turn.ticket.requestHash, status: turn.status, closed: Boolean(turn.closed), summaryCellId: turn.notebookResult?.summaryCellId })),
      changes, actions: flags.offline ? ["cell", "output", "put", "batch", "manifest", "inputs", "organize", "run", "job", "finish"] : ["cell", "output", "put", "batch", "manifest", "inputs", "organize", "run", "job", "evidence", "finish", "phase"],
      manuscript: { documentUrl: `${origin}/api/paperfocus/document?${new URLSearchParams({ projectId })}`, saveUrl: `${origin}/api/paperfocus/document`, compileUrl: `${origin}/api/paperfocus/compile`, capturedSource: entry.source, note: "Read current source/revision before authorized edits. Notebook completion does not apply manuscript edits." },
      cells,
      context: changes ? "Changed cells listed above; use cell/output for complete evidence. Nothing is rerun or marked read." : experimentContext(store.notebook, notebookId, flags.expanded ? "expanded" : "compact", store.path),
    };
  }
  const cell = store.notebook.cells.find((item: { id: string }) => item.id === flags.cell);
  if (command === "inputs") {
    if (!cell) throw new Error("Cell not found.");
    return { ...identity, cellId: cell.id, declared: cell.metadata.paperfocus?.inputs ?? [], check: await inputCheck(cell), staleReason: experimentStaleness(cell, store.notebook), note: "No captured hashes means untracked, not verified. This does not execute code." };
  }
  if (command === "cell") {
    if (!cell) throw new Error("Cell not found.");
    const inputs = await inputCheck(cell);
    return { ...identity, cell, inputCheck: inputs, staleReason: experimentStaleness(cell, store.notebook) ?? (inputs?.changed.length ? "declared input files changed since execution" : undefined) };
  }
  if (command === "output") {
    const index = Number(flags.output), output = cell?.outputs?.[index];
    if (!output) throw new Error("Saved output not found. Reinspect the current run's indices.");
    const inputs = await inputCheck(cell);
    return { ...identity, cellId: cell!.id, index, label: savedOutputLabel(output, index), staleReason: experimentStaleness(cell!, store.notebook) ?? (inputs?.changed.length ? "declared input files changed since execution" : undefined), inputCheck: inputs, output };
  }
  const revision = flags.revision === "missing" ? "" : flags.revision;
  if (store.revision !== revision) throw new Error("Notebook changed. Reinspect and reconcile; no changes or execution started.");
  if (command === "batch") {
    const edits = await agentJson(flags.file), notebook = await prepareAgentBatch(store.notebook, edits, path.dirname(path.resolve(flags.file)));
    const cells = edits.changes.map((change: any) => change.cell);
    if (!flags.commit) return { ...identity, cells, planned: true, saved: false, executed: false, storage: { compactCharacters: JSON.stringify(notebook).length, compactLimit: 4_000_000 }, note: "No save yet. Repeat the same revision/file with --commit after reviewing the plan." };
    const saved = await request("experiments", { projectId, notebookId, revision, notebook });
    return { ...identity, revision: saved.revision, cells, saved: true, executed: false };
  }
  if (command === "finish") return request("research/finish", { projectId, entryId: entry.id, notebookId, taskId: flags.task, requestHash: flags["request-hash"], summaryCellId: flags["summary-cell"], revision });
  if (command === "organize") {
    const patch: CellArrangement = {};
    if (flags.output !== undefined) { if (!/^\d{1,2}$/.test(flags.output)) throw new Error("Use a zero-based saved --output index."); patch.featuredOutput = Number(flags.output); }
    for (const [name, field] of [["pin", "pinned"], ["highlight", "highlighted"], ["suppress", "suppressed"], ["filed", "filed"], ["trash", "deleted"]] as const) if (flags[name] !== undefined) patch[field] = flags[name] === "true";
    for (const name of ["folder", "before", "after"] as const) if (flags[name] !== undefined) patch[name] = flags[name];
    const saved = await request("experiments", { projectId, notebookId, revision, notebook: arrangeExperimentCell(store.notebook, flags.cell, patch) });
    return { ...identity, revision: saved.revision, cellId: flags.cell, saved: true, executed: false };
  }
  if (command === "evidence") return { ...identity, snapshot: await request("experiments/evidence", { projectId, entryId: entry.id, notebookId, revision }) };
  if (command === "run") {
    if (cell?.metadata.paperfocus?.inputs?.length && health.features?.experimentInputs !== true) throw new Error("This service cannot capture declared inputs yet. No run started. Wait for a safe restart; do not interrupt other owners or bypass the declaration.");
    const timeoutMs = experimentRunBudget(flags["timeout-seconds"] === undefined ? undefined : Number(flags["timeout-seconds"]) * 1000);
    checkExperimentBudgetRuntime(store.runtime, timeoutMs);
    const job = await request("experiments/run", { projectId, notebookId, cellId: flags.cell, revision, acknowledgeLocalExecution: true, executionMode: flags.session ? "session" : "fresh", timeoutMs });
    return { ...identity, revision: job.revision || identity.revision, job };
  }
  if (flags.kind && !["markdown", "code", "raw"].includes(flags.kind)) throw new Error("Use --kind markdown, code or raw.");
  if (cell && flags.kind && cell.cell_type !== flags.kind) throw new Error("Existing cell kind is preserved. Use a new ID to change kinds.");
  const sourcePath = path.resolve(flags.file);
  if ((await stat(sourcePath)).size > 400_000) throw new Error("Cell source file is too large.");
  const source = await readFile(sourcePath, "utf8");
  if (source.length > 100_000) throw new Error("Cell source exceeds 100,000 characters.");
  const next = cell ?? { ...newExperimentCell((flags.kind ?? "markdown") as "markdown" | "code" | "raw"), id: flags.cell };
  next.source = source;
  if (flags.inputs) { const inputs = await agentJson(flags.inputs, 30_000); validateExperimentInputs(inputs); if (next.cell_type !== "code") throw new Error("Only code cells declare inputs."); next.metadata.paperfocus = { ...next.metadata.paperfocus, inputs }; }
  if (flags.title !== undefined) next.metadata.paperfocus = { ...next.metadata.paperfocus, title: flags.title };
  if (!cell) {
    const index = flags.after ? store.notebook.cells.findIndex((item: { id: string }) => item.id === flags.after) : store.notebook.cells.length - 1;
    if (flags.after && index < 0) throw new Error("The --after anchor is missing. No changes made.");
    store.notebook.cells.splice(index + 1, 0, next);
  }
  const saved = await request("experiments", { projectId, notebookId, revision, notebook: store.notebook });
  return { ...identity, revision: saved.revision, cellId: next.id, saved: true, executed: false };
}

async function notebookStorage(store: { path: string; revision: string; notebook: unknown }) {
  const compactCharacters = JSON.stringify(store.notebook).length;
  const diskBytes = store.revision ? (await stat(store.path)).size : 0;
  return { compactCharacters, compactCharacterLimit: 4_000_000, diskBytes, diskByteLimit: 5_000_000,
    phaseSuggested: compactCharacters >= 3_200_000 || diskBytes >= 4_000_000,
    note: "Filing hides cells but does not shrink their notebook. Reuse saved evidence; with archival permission use phase to version a substantial research transition, not every turn." };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try { const result = await researchCommand(process.argv.slice(2)); console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2)); if (typeof result !== "string" && result?.job?.status === "failed") process.exitCode = 1; }
  catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
