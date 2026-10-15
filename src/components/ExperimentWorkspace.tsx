import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cellText, experimentContext, experimentStaleness, experimentPlot, importExperimentNotebook, mergeExperimentNotebooks, mimeText, newExperimentCell, outputText, validateExperimentNotebook } from "../experiments";
import type { ExperimentCell, ExperimentJob, ExperimentNotebook, ExperimentOutput, ExperimentSession, ExperimentStore } from "../experiments";
import { ExperimentPlotView as Plot } from "./ExperimentPlotView";
import { useStableEvent } from "../useStableEvent";
import { initialWindowRequest, windowStateCache } from "../windowCache";
import { experimentRecoverySnapshot } from "../windowWorkspace";
import { ReplyMarkdown } from "../replyMarkdown";
import { createJsonSnapshotter } from "../jsonSnapshot";
import { LazyDisclosure } from "../lazyDisclosure";
import { experimentAgentInstructions } from "../researchInstructions";
import type { ManuscriptPurpose } from "../types";
import { registerExperimentDraft } from "../experimentDrafts";
import { experimentRunBudgets, experimentBudgetLabel, experimentDuration, checkExperimentBudgetRuntime } from "../experimentLimits";
import { experimentSweep, sweepMime } from "../experimentSweep";
import { ExperimentSweepView } from "./ExperimentSweepView";
import { experimentHeatmap, heatmapMime } from "../experimentHeatmap";
import { ExperimentHeatmapView } from "./ExperimentHeatmapView";
import { moveCatalogueItem } from "../notebookCatalogue";
import { savedImageSize, removeCellImages, restoreCellImages, imageSizeLabel } from "../experimentImages";
import { arrangeExperimentCell, experimentCellDomId, featuredOutputIndex, savedOutputLabel, notebookShortcut } from "../experimentActions";
import { ResearchSetup } from "./ResearchSetup";
import { experimentCellUrl, latexEvidenceLink } from "../researchLinks";
import type { WindowRequest } from "../windowWorkspace";

class RequestError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
async function request<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(url, data === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json(); if (!response.ok) throw new RequestError(result.error || "Experiment request failed", response.status); return result;
}
async function changedNotebook(url: string, revision?: string): Promise<ExperimentStore | undefined> {
  const response = await fetch(url, { cache: "no-store", headers: revision === undefined ? undefined : { "If-None-Match": `"${revision || "missing"}"` } });
  if (response.status === 304) return undefined;
  const result = await response.json(); if (!response.ok) throw new RequestError(result.error || "Experiment request failed", response.status); return result;
}
function download(notebook: ExperimentNotebook) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(notebook, null, 2)], { type: "application/x-ipynb+json" }));
  const link = document.createElement("a"); link.href = url; link.download = "experiments.ipynb"; link.click(); URL.revokeObjectURL(url);
}
const Output = memo(function Output({ output }: { output: ExperimentOutput }) {
  const plot = experimentPlot(output.data?.["application/vnd.paperfocus.plot+json"]);
  const sweep = experimentSweep(output.data?.[sweepMime]);
  const grid = experimentHeatmap(output.data?.[heatmapMime]);
  const png = mimeText(output.data?.["image/png"]), value = output.data?.["application/json"];
  const markdown = mimeText(output.data?.["text/markdown"]);
  const text = grid || sweep || plot || png || value !== undefined || markdown ? "" : outputText(output);
  const rows = Array.isArray(value) && value.every((row) => row && typeof row === "object" && !Array.isArray(row)) ? value as Record<string, unknown>[] : undefined;
  const columns = rows ? [...new Set(rows.flatMap(Object.keys))].slice(0, 20) : [];
  const numberText = (n: number) => Number.isFinite(n) ? String(Number(n.toPrecision(6))) : String(n);
  const table = rows ? <div className="experiment-table"><table><thead><tr>{columns.map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, i) => <tr key={i}>{columns.map((key) => <td key={key} title={typeof row[key] === "number" ? String(row[key]) : undefined}>{typeof row[key] === "number" ? numberText(row[key]) : typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key] ?? "")}</td>)}</tr>)}</tbody></table><small>Numbers shortened for display; exact values are saved{rows.length > 100 ? "; first 100 rows shown" : ""}.</small></div> : undefined;
  return <div className={`experiment-output ${output.output_type === "error" ? "experiment-error" : ""}`}>
    {grid ? <ExperimentHeatmapView grid={grid} /> : sweep ? <ExperimentSweepView sweep={sweep} /> : plot && <Plot plot={plot} />}{typeof png === "string" && <img src={`data:image/png;base64,${png}`} alt="Saved Python figure" loading="lazy" />}
    {!grid && !sweep && !plot && !png && value === undefined && markdown && <ReplyMarkdown text={markdown} />}
    {rows ? rows.length > 12 ? <LazyDisclosure summary={`Saved table · ${rows.length} rows`}>{table}</LazyDisclosure> : table : value !== undefined && <pre>{JSON.stringify(value, null, 2)}</pre>}
    {text && (output.output_type === "stream" && text.length > 400 ? <LazyDisclosure summary="Run log"><pre>{text}</pre></LazyDisclosure> : <pre>{text}</pre>)}{!grid && !sweep && !plot && !png && value === undefined && !text && !markdown && <small>This output is saved in the .ipynb file but can't be displayed. HTML and JavaScript aren't executed.</small>}
  </div>;
});
/** Tick only the notice, not every editor and figure in a large catalogue. */
function RunningStatus({ job }: { job: ExperimentJob }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") setNow(Date.now()); }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <>Python running{job.startedAt ? ` · ${Math.max(0, Math.floor((now - Date.parse(job.startedAt)) / 1000))} s elapsed` : ""} · {experimentBudgetLabel(job.execution?.timeoutMs ?? 30_000)} limit. Keep working; results save here.</>;
}
export const ExperimentWorkspace = memo(function ExperimentWorkspace({ projectId, entryId, notebookId, trusted, onTrust, onContext, onPin, compact = false, linkTarget, passageHref, manuscriptFile, purpose }: { projectId: string; entryId: string; notebookId: string; trusted: boolean; onTrust: (trusted: boolean) => void; onContext: (context: string) => void; onPin: () => void; compact?: boolean; linkTarget?: WindowRequest; passageHref?: string; manuscriptFile?: string; purpose?: ManuscriptPurpose }) {
  const serialize = useMemo(() => createJsonSnapshotter(), []);
  const equal = (a: unknown, b: unknown) => serialize(a) === serialize(b);
  const [notebook, setNotebook] = useState<ExperimentNotebook>();
  const [expanded, setExpanded] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [view, setView] = useState<"active" | "filed" | "trash">("active");
  const [filedFolder,setFiledFolder]=useState("");
  const [folded, setFolded] = useState<Record<string, boolean>>({}), [outputsHidden, setOutputsHidden] = useState<Record<string, boolean>>({});
  const [sourceOpen, setSourceOpen] = useState<Record<string, boolean>>({});
  const [allOutputs, setAllOutputs] = useState<Record<string, boolean>>({});
  const [linkedOutput, setLinkedOutput] = useState<Record<string, number>>({}), [linkOutput, setLinkOutput] = useState<Record<string, string>>({});
  const [linkNotice, setLinkNotice] = useState(""), [copyText, setCopyText] = useState("");
  const handledLink = useRef(false);
  const [imageUndo,setImageUndo]=useState<Record<string,ExperimentCell>>({});
  const pythonSettings = useRef<HTMLDetailsElement>(null);
  const workspaceElement = useRef<HTMLElement>(null);
  const cellElement = (id: string) => workspaceElement.current?.querySelector<HTMLElement>(`[data-cell-id="${id}"]`);
  const [job, setJob] = useState<ExperimentJob>(), [path, setPath] = useState("");
  const [executionMode, setExecutionMode] = useState<"fresh" | "session">("fresh");
  const [runBudget, setRunBudget] = useState<number>(30_000);
  const [session, setSession] = useState<ExperimentSession>();
  const [tick, setTick] = useState(0);
  const base = useRef<ExperimentStore | undefined>(undefined), current = useRef<ExperimentNotebook | undefined>(undefined), locked = useRef(false), paused = useRef(false), alive = useRef(true), sentContext = useRef<string | undefined>(undefined);
  const cacheKey = `paperfocus:experiments:${projectId}:${notebookId}`, endpoint = "/api/paperfocus/experiments";
  const draftCacheKey = `${cacheKey}:drafts.v2`;
  const cacheDraft = (baseline: ExperimentNotebook, notebook: ExperimentNotebook) => windowStateCache().writeSnapshot(draftCacheKey,
    experimentRecoverySnapshot(baseline, notebook, serialize), "{}");
  const params = new URLSearchParams({ projectId, notebookId }).toString();
  const context = useStableEvent(onContext);
  useEffect(() => {
    if (executionMode !== "session") return;
    let stopped = false, fetching = false;
    async function status() {
      if (fetching) return; fetching = true;
      try { const result = await request<ExperimentSession>(`${endpoint}/session?${params}`); if (!stopped) setSession(result); }
      catch (reason) { if (!stopped) setError((reason as Error).message); }
      finally { fetching = false; }
    }
    void status();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void status(); }, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [executionMode, params, job?.status]);
  async function restartSession() {
    try { setSession(await request<ExperimentSession>(`${endpoint}/restart-session`, { projectId, notebookId })); setError(""); }
    catch (reason) { setError((reason as Error).message); }
  }
  async function copyAgentInstructions() {
    try {
      const health = await request<{ app: string; workspaceRoot: string; codeRoot?: string }>("/api/paperfocus/health");
      if (!path || health.app !== "active-writing") throw new Error("Notebook path is not ready.");
      await navigator.clipboard.writeText(experimentAgentInstructions({ origin: location.origin, workspace: health.workspaceRoot, codeRoot: health.codeRoot, projectId, entryId, notebookId, path, manuscriptFile, purpose }));
    } catch { setError("Could not copy instructions. The notebook path and workflow guide can be copied manually."); }
  }
  const adopt = (nb: ExperimentNotebook) => { current.current = nb; setNotebook(nb); if (base.current) { try { cacheDraft(base.current.notebook, nb); } catch { setError("Browser storage is full; saving to disk still works."); } } };
  const refresh = useStableEvent(async () => {
    if (locked.current || paused.current) return;
    locked.current = true;
    try {
      const remote = await changedNotebook(`${endpoint}?${params}`, base.current?.revision); if (!alive.current) return;
      if (!remote) { if (!paused.current) setError(""); if (base.current && current.current && !equal(base.current.notebook, current.current)) setTick((value) => value + 1); return; }
      setPath(remote.path);
      if (!base.current) {
        let restored = remote.notebook;
        let cached: { base?: ExperimentNotebook; notebook?: ExperimentNotebook } | undefined;
        try { cached = JSON.parse(windowStateCache().read(draftCacheKey,Boolean(initialWindowRequest)) ?? localStorage.getItem(cacheKey) ?? "null"); } catch { /* do not block disk recovery on malformed cache */ }
        if (cached?.notebook && cached.base) {
          try { validateExperimentNotebook(cached.notebook); validateExperimentNotebook(cached.base); restored = mergeExperimentNotebooks(cached.base, cached.notebook, remote.notebook); }
          catch (reason) { validateExperimentNotebook(cached.notebook); restored = cached.notebook; paused.current = true; setError((reason as Error).message); }
        }
        base.current = remote; adopt(restored);
      } else if (remote.revision !== base.current.revision) {
        const merged = mergeExperimentNotebooks(base.current.notebook, current.current!, remote.notebook);
        base.current = remote; adopt(merged);
      }
      if (!paused.current) setError(""); if (base.current && current.current && !equal(base.current.notebook, current.current)) setTick((value) => value + 1);
    } catch (reason) { if (alive.current) { if (base.current && !(reason instanceof RequestError)) paused.current = true; setError((reason as Error).message); } }
    finally { locked.current = false; }
  });
  const save = useStableEvent(async () => {
    if (!base.current || !current.current || locked.current || paused.current) return undefined;
    if (equal(base.current.notebook, current.current)) return base.current;
    locked.current = true; setSaving(true); const draft = structuredClone(current.current);
    try {
      const result = await request<ExperimentStore>(endpoint, { projectId, notebookId, revision: base.current.revision, notebook: draft });
      const merged = mergeExperimentNotebooks(draft, current.current!, result.notebook);
      base.current = result;
      if (alive.current) { adopt(merged); setError(""); }
      else { current.current = merged; try { const cached = JSON.parse(windowStateCache().read(draftCacheKey) || "null"); if (equal(cached?.notebook, draft)) cacheDraft(result.notebook, merged); } catch { /* original recovery cache retained */ } }
      return result;
    } catch (reason) {
      if (alive.current) setError((reason as Error).message);
      if (reason instanceof RequestError && reason.status === 409) { locked.current = false; await refresh(); }
      return undefined;
    } finally { locked.current = false; if (alive.current) setSaving(false); }
  });
  const flushDraft = useStableEvent(async () => {
    for (let i = 0; locked.current && i < 40; i++) await new Promise(resolve => window.setTimeout(resolve, 50));
    if (locked.current || paused.current || !base.current || !current.current) throw new Error("Experiments aren't saved yet. Your question is kept; check the notebook and retry.");
    const saved = await save();
    if (!saved || !equal(base.current?.notebook, current.current)) throw new Error("Couldn't save the latest experiment edits. Your question is kept; retry after saving.");
  });
  useEffect(() => registerExperimentDraft(projectId, notebookId, flushDraft), [projectId, notebookId, flushDraft]);
  useEffect(() => {
    if (!notebook || !linkTarget?.cellId || handledLink.current) return;
    handledLink.current = true;
    const cell = notebook.cells.find(item => item.id === linkTarget.cellId);
    if (!cell) { setLinkNotice("The linked cell is no longer in this notebook. No evidence was substituted or rerun."); return; }
    reveal(cell.id); setOutputsHidden(old => ({ ...old, [cell.id]: false }));
    if (linkTarget.outputIndex !== undefined) {
      if (cell.outputs?.[linkTarget.outputIndex]) {
        setLinkedOutput(old => ({ ...old, [cell.id]: linkTarget.outputIndex! }));
        setLinkOutput(old => ({ ...old, [cell.id]: String(linkTarget.outputIndex) }));
      } else setLinkNotice("That saved output index is no longer available. The cell is shown; no other output was presented as the linked one.");
    }
    if (linkTarget.evidenceRevision && linkTarget.evidenceRevision !== base.current?.revision) setLinkNotice(old => `${old ? `${old} ` : ""}This notebook changed since the link was copied; you are viewing its current saved evidence.`);
  }, [notebook, linkTarget]);
  useEffect(() => {
    alive.current = true; void refresh();
    try { const cachedJob = JSON.parse(localStorage.getItem(`${cacheKey}:job`) || "null"); if (cachedJob?.id) setJob(cachedJob); } catch { /* saved outputs do not depend on job cache */ }
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 3000);
    return () => {
      alive.current = false; window.clearInterval(interval);
      // Navigation flushes the most recent draft even if a previous save/poll is still finishing.
      void (async () => { for (let i = 0; locked.current && i < 100; i++) await new Promise((resolve) => window.setTimeout(resolve, 50)); await save(); })();
    };
  }, [refresh, cacheKey]);
  useEffect(() => {
    if (!notebook || !base.current) return;
    const summary = notebook.cells.length ? experimentContext(notebook, notebookId, "compact", path) : "";
    if (summary !== sentContext.current) { sentContext.current = summary; context(summary); }
    // adopt() already cached this exact draft synchronously. Do not repeat the
    // same large browser write after every keystroke or unchanged disk poll.
    const timeout = window.setTimeout(() => { void save(); }, 500); return () => window.clearTimeout(timeout);
  }, [notebook, tick, cacheKey, notebookId, path, context, save]);
  useEffect(() => {
    try { if (job) localStorage.setItem(`${cacheKey}:job`, JSON.stringify(job)); else localStorage.removeItem(`${cacheKey}:job`); } catch { /* saved run records are independent */ }
    if (job?.status !== "working") return;
    let stopped = false, polling = false;
    const poll = async () => { if (polling || stopped) return; polling = true; try {
      const result = await request<ExperimentJob>(`${endpoint}/job?${params}&id=${job.id}`);
      if (!stopped && result.status !== "working") { setJob(result); await refresh(); }
    } catch (reason) { if (!stopped) { setJob({ ...job, status: "failed", error: (reason as Error).message }); await refresh(); } } finally { polling = false; } };
    const interval = window.setInterval(() => { void poll(); }, 1000); void poll();
    return () => { stopped = true; window.clearInterval(interval); };
  }, [job?.id, job?.status, params, cacheKey, refresh]);
  function edit(id: string, patch: Partial<ExperimentCell>) { if (current.current) adopt({ ...current.current, cells: current.current.cells.map((cell) => cell.id === id ? { ...cell, ...patch } : cell) }); }
  function flag(cell: ExperimentCell, patch: NonNullable<ExperimentCell["metadata"]["paperfocus"]>) { if (current.current) adopt(arrangeExperimentCell(current.current, cell.id, patch)); if (patch.suppressed !== undefined || patch.pinned === true) setFolded(old => ({ ...old, [cell.id]: patch.pinned === true ? false : patch.suppressed! })); }
  function moveCell(id:string,targetId:string,before=true){if(current.current)adopt({...current.current,cells:moveCatalogueItem(current.current.cells,id,targetId,before)});}
  function removeImages(id:string){const cell=current.current?.cells.find(item=>item.id===id);if(!cell || job?.status==="working")return;setImageUndo(old=>({...old,[id]:structuredClone(cell)}));edit(id,removeCellImages(cell));}
  function undoImages(id:string){const cell=current.current?.cells.find(item=>item.id===id),original=imageUndo[id];if(!cell || !original)return;try{edit(id,restoreCellImages(cell,original));setImageUndo(old=>{const next={...old};delete next[id];return next;});}catch(reason){setError((reason as Error).message);}}
  function add(kind: ExperimentCell["cell_type"], after?: string) { if (current.current) { const cell = newExperimentCell(kind), cells = [...current.current.cells]; cells.splice(after ? cells.findIndex(item => item.id === after) + 1 : cells.length, 0, cell); adopt({ ...current.current, cells }); setSourceOpen(old => ({ ...old, [cell.id]: true })); reveal(cell.id, true); } }
  function reveal(id: string, focusSource = false) {
    const cell = current.current?.cells.find(item => item.id === id); if (!cell) return;
    setView(cell.metadata.paperfocus?.deleted ? "trash" : cell.metadata.paperfocus?.filed ? "filed" : "active"); setFiledFolder(""); setExpanded(true); setFolded(old => ({ ...old, [id]: false }));
    if (focusSource) setSourceOpen(old => ({ ...old, [id]: true }));
    window.setTimeout(() => { const target = cellElement(id); target?.scrollIntoView({ block: "nearest", behavior: "smooth" }); (focusSource ? target?.querySelector("textarea") : target)?.focus(); }, 0);
  }
  async function copyEvidenceLink(cell: ExperimentCell, latex = false) {
    try {
      await flushDraft();
      const choice = linkOutput[cell.id], index = choice && choice !== "cell" ? Number(choice) : undefined;
      const saved = base.current!;
      if (!saved.notebook.cells.some(item => item.id === cell.id && (index === undefined || item.outputs?.[index]))) throw new Error("The linked evidence changed before copying. Recheck the cell.");
      const url = experimentCellUrl(location.href, projectId, entryId, cell.id, saved.revision, index, passageHref);
      const text = latex ? latexEvidenceLink(url, index === undefined ? "Notebook evidence" : "Saved output") : url;
      try { await navigator.clipboard.writeText(text); setCopyText(""); setLinkNotice("Evidence link copied. It opens saved data, not a new run."); }
      catch { setCopyText(text); setLinkNotice("Clipboard unavailable; copy this link manually."); }
    } catch (reason) { setLinkNotice((reason as Error).message); }
  }
  function advance(id: string) {
    const activeCells = current.current?.cells.filter(cell => !cell.metadata.paperfocus?.filed && !cell.metadata.paperfocus?.deleted) ?? [];
    const next = activeCells[activeCells.findIndex(cell => cell.id === id) + 1];
    if (next) reveal(next.id, true); else add("markdown", id);
  }
  async function run(cell: ExperimentCell) {
    if (!trusted || job?.status === "working" || paused.current) { setError(!trusted ? "Review Python settings before running code." : "Wait for the current run or resolve the save warning first."); return false; }
    for (let i = 0; locked.current && i < 20; i++) await new Promise((resolve) => window.setTimeout(resolve, 50));
    const stored = await save(); if (!stored) return false;
    try {
      if (runBudget !== 30_000) {
        const service = await request<ExperimentStore & { runtime?: { runBudgetsMs?: number[] } }>(`${endpoint}?${params}`);
        checkExperimentBudgetRuntime(service.runtime, runBudget);
      }
      setJob(await request<ExperimentJob>(`${endpoint}/run`, { projectId, notebookId, cellId: cell.id, revision: stored.revision, acknowledgeLocalExecution: trusted, executionMode, timeoutMs: runBudget }));
      return true;
    }
    catch (reason) { setError((reason as Error).message); return false; }
  }
  async function importFile(file: File | undefined) {
    if (!file || !current.current) return;
    try {
      if (file.size > 5_000_000) throw new Error("Choose an .ipynb smaller than 5 MB.");
      const incoming = importExperimentNotebook(JSON.parse(await file.text()));
      const combined = { ...current.current, cells: [...current.current.cells, ...incoming.cells.map((cell) => ({ ...cell, id: crypto.randomUUID() }))] };
      validateExperimentNotebook(combined); adopt(combined); setExpanded(true); setView("active"); setError("");
    } catch (reason) { setError((reason as Error).message); }
  }
  async function reloadDisk() {
    try { if (current.current) localStorage.setItem(`${cacheKey}:recovered:${Date.now()}`, JSON.stringify(current.current));
      const disk = await request<ExperimentStore>(`${endpoint}?${params}`); base.current = disk; paused.current = false; adopt(disk.notebook); setError("");
    } catch (reason) { setError((reason as Error).message); }
  }
  const active = notebook?.cells.filter((cell) => !cell.metadata.paperfocus?.deleted && !cell.metadata.paperfocus?.filed).length ?? 0;
  const catalogueOpen = expanded && !compact;
  const filedFolders=[...new Set(notebook?.cells.filter(cell=>cell.metadata.paperfocus?.filed && !cell.metadata.paperfocus?.deleted).map(cell=>cell.metadata.paperfocus?.folder?.trim() || "Later") ?? [])];
  const folderFilter=filedFolders.includes(filedFolder)?filedFolder:"";
  const visible = notebook?.cells.filter((cell) => !catalogueOpen ? cell.metadata.paperfocus?.pinned && !cell.metadata.paperfocus?.deleted && !cell.metadata.paperfocus?.filed : view === "trash" ? cell.metadata.paperfocus?.deleted : !cell.metadata.paperfocus?.deleted && (view === "filed" ? cell.metadata.paperfocus?.filed && (!folderFilter || (cell.metadata.paperfocus?.folder?.trim() || "Later")===folderFilter) : !cell.metadata.paperfocus?.filed)) ?? [];
  return <section ref={workspaceElement} data-experiment-entry={entryId} className={`experiment-workspace ${compact ? "is-compact" : ""}`}>
    <header>{compact ? <span className="experiment-pin-caption">Pinned experiment{visible.length === 1 ? "" : "s"}</span> : <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Experiments <span>{active}</span></button>}<small>{saving ? "Saving…" : paused.current ? "Draft kept · saving paused" : notebook && base.current && !equal(notebook, base.current.notebook) ? "Draft kept" : "Saved locally"}</small></header>
    {job && <div className={`experiment-run-notice ${job.status}`} role="status">{job.status === "working" ? <RunningStatus key={job.id} job={job} /> : job.status === "ready" ? `Experiment ready · ${experimentDuration(job.durationMs ?? 0)}` : job.error || "Experiment stopped"}{job.status === "working" ? <button onClick={async () => { try { setJob(await request(`${endpoint}/cancel`, { projectId, notebookId, id: job.id })); } catch (reason) { setError((reason as Error).message); } }}>Stop</button> : <><button onClick={() => reveal(job.cellId)}>Show result</button><button aria-label="Dismiss experiment notice" onClick={() => setJob(undefined)}>×</button></>}</div>}
    {error && <div className="experiment-error" role="alert">{error}{paused.current && <><button onClick={() => notebook && download(notebook)}>Export draft</button><button onClick={() => { void reloadDisk(); }}>Use disk version · keep a recovery copy</button></>}</div>}
    {linkNotice && <p className="experiment-link-notice" role="status">{linkNotice}</p>}
    {copyText && <textarea aria-label="Evidence link to copy" readOnly value={copyText} rows={3} />}
    {(catalogueOpen || visible.length > 0) && <>
      {catalogueOpen && <>
      {Boolean(notebook?.metadata.awVersionOrigin) && <small className="experiment-link-notice">Saved evidence carried from an earlier manuscript version. No experiment was rerun; original run records remain in the earlier notebook.</small>}
      <div className="experiment-toolbar"><button disabled={!notebook} onClick={() => add("code")}>+ Python</button><button disabled={!notebook} onClick={() => add("markdown")}>+ Note</button><select aria-label="Jump to notebook cell" value="" onChange={event => { if (event.target.value) reveal(event.target.value); }}><option value="">Jump to cell…</option>{notebook?.cells.map(cell => <option key={cell.id} value={cell.id}>{cell.metadata.paperfocus?.deleted ? "Trash · " : cell.metadata.paperfocus?.filed ? "Filed · " : ""}{cell.metadata.paperfocus?.title || cell.id}</option>)}</select><label className="experiment-import">Import .ipynb<input type="file" accept=".ipynb,application/json" aria-label="Import experiment notebook" onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label><button disabled={!notebook} onClick={() => notebook && download(notebook)}>Export</button></div>
      <div className="experiment-tabs" role="group" aria-label="Experiments">{(["active", "filed", "trash"] as const).map((name) => <button key={name} aria-pressed={view === name} onClick={() => setView(name)}>{name === "active" ? "Active" : name === "filed" ? "Filed away" : "Trash"} {notebook?.cells.filter((cell) => name === "trash" ? cell.metadata.paperfocus?.deleted : !cell.metadata.paperfocus?.deleted && (name === "filed" ? cell.metadata.paperfocus?.filed : !cell.metadata.paperfocus?.filed)).length ?? 0}</button>)}</div>
      {catalogueOpen && view==="filed" && filedFolders.length>0 && <label className="experiment-folder-filter">Folder <select aria-label="Filed experiment folder" value={folderFilter} onChange={event=>setFiledFolder(event.target.value)}><option value="">All folders</option>{filedFolders.map(folder=><option key={folder} value={folder}>{folder}</option>)}</select></label>}
      {!trusted && notebook?.cells.some((cell) => cell.cell_type === "code" && !cell.metadata.paperfocus?.deleted && !cell.metadata.paperfocus?.filed) && <div className="experiment-enable"><small>Python is off.</small><button onClick={() => { if (pythonSettings.current) { pythonSettings.current.open = true; pythonSettings.current.scrollIntoView({ block: "nearest" }); pythonSettings.current.querySelector<HTMLInputElement>("input")?.focus(); } }}>Review Python settings</button></div>}
      <details ref={pythonSettings} className="experiment-settings"><summary>Python settings & safety</summary><p className="experiment-help">Notes and outputs save automatically; numerical evidence is not proof. Nothing runs when you switch modes.</p>
      <label>Execution<select aria-label="Python execution mode" value={executionMode} onChange={event => setExecutionMode(event.target.value as "fresh" | "session")}><option value="fresh">Fresh cell · independent</option><option value="session">Shared session · this notebook</option></select></label>
      <label>Run limit<select aria-label="Python run limit" value={runBudget} onChange={event => setRunBudget(Number(event.target.value))}>{experimentRunBudgets.map(ms => <option key={ms} value={ms}>{experimentBudgetLabel(ms)}{ms === 30_000 ? " · default" : ""}</option>)}</select></label><small>Applies to future explicit runs; resets to 30 seconds when this notebook is reopened. Stop remains available. Changing the limit doesn't extend a running cell.</small>
      {executionMode === "fresh" ? <p className="experiment-help">Each run starts fresh. Make each cell self-contained.</p> : <div className="experiment-session"><small>{session?.active ? `Session open · ${session.runs} runs` : "No session · the next Run starts one"}. Variables last until restart, a failed or stopped cell, server shutdown, or 15 minutes idle. Run order matters; saved outputs are not live variables.</small><button disabled={job?.status === "working" || session?.busy || !session?.active} onClick={() => void restartSession()}>Restart session</button><small>Restart and rerun setup cells explicitly to reproduce a result. Limit: 3 open sessions, 100 runs per session.</small></div>}
      <label className="experiment-trust"><input type="checkbox" checked={trusted} onChange={(event) => onTrust(event.target.checked)} />Allow Python for this paper until reload. Code has normal file and network access; it isn't sandboxed.</label></details>
      {!visible.length && <p className="experiment-empty">{view === "active" ? "Add a self-contained experiment or import a notebook. Nothing runs on import." : "Nothing here yet."}</p>}
      </>}
      {visible.map((cell) => {
        const index=visible.findIndex(item=>item.id===cell.id),images=savedImageSize(cell);
        const meta = cell.metadata.paperfocus ?? {}, collapsed = Boolean(folded[cell.id] ?? (meta.suppressed || !meta.pinned)), stale = experimentStaleness(cell, notebook!);
        const editing = sourceOpen[cell.id] ?? (!cellText(cell) || cell.cell_type === "raw" || cell.cell_type === "code" && !cell.outputs?.length);
        const featured = linkedOutput[cell.id] ?? featuredOutputIndex(cell);
        const outputChoice = !!cell.outputs && (cell.outputs.length > 2 || linkedOutput[cell.id] !== undefined);
        const shownOutputs = !compact && (!outputChoice || allOutputs[cell.id]) ? cell.outputs ?? [] : cell.outputs?.filter((output, i) => i === featured || linkedOutput[cell.id] === undefined && output.output_type === "error") ?? [];
        return <article id={experimentCellDomId(entryId, cell.id)} key={cell.id} tabIndex={-1} aria-label={`Notebook cell: ${meta.title || cell.id}`} data-cell-id={cell.id} className={`experiment-cell ${meta.highlighted ? "highlighted" : ""} ${meta.suppressed ? "suppressed" : ""}`}
          onDragOver={event=>{if(event.dataTransfer.types.includes("application/x-aw-cell"))event.preventDefault();}}
          onDrop={event=>{const id=event.dataTransfer.getData("application/x-aw-cell");if(id){event.preventDefault();event.stopPropagation();moveCell(id,cell.id);}}}>
          <button className="catalogue-drag-handle experiment-drag-handle" draggable aria-label={`Reorder experiment: ${meta.title || cell.id}`} title="Drag to reorder · up/down in Organize cell" onDragStart={event=>{event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("application/x-aw-cell",cell.id);}}><span aria-hidden="true">⠿</span></button>
          <details className="experiment-evidence-links"><summary>Links</summary><div>
            <select aria-label={`Evidence link target for ${meta.title || cell.id}`} value={linkOutput[cell.id] ?? "cell"} onChange={event => setLinkOutput(old => ({ ...old, [cell.id]: event.target.value }))}><option value="cell">This cell</option>{cell.outputs?.map((output, i) => <option value={i} key={i}>{savedOutputLabel(output, i)}</option>)}</select>
            <button onClick={() => { void copyEvidenceLink(cell); }}>Copy evidence link</button><button onClick={() => { void copyEvidenceLink(cell, true); }}>Copy LaTeX reference</button>
            {passageHref && <a href={passageHref} target="_blank" rel="noopener noreferrer">Return to manuscript passage</a>}
            <small>Live saved evidence. Copy an immutable evidence snapshot separately when a fixed version matters.</small>
          </div></details>
          <header><button aria-label={`${collapsed ? "Expand" : meta.pinned ? "Unpin and collapse" : "Collapse"} ${meta.title || cell.id}`} aria-expanded={!collapsed} onClick={() => { if (meta.suppressed) flag(cell, { suppressed: false }); if (meta.pinned && !collapsed) flag(cell, { pinned: false }); setFolded((old) => ({ ...old, [cell.id]: !collapsed })); }}>{collapsed ? "▸" : "▾"}</button><input aria-label="Experiment title" value={meta.title || ""} placeholder={cell.cell_type === "code" ? "Experiment" : "Research note"} onChange={(event) => flag(cell, { title: event.target.value })} /><small>{cell.cell_type === "code" ? `Python [${cell.execution_count ?? " "}]` : "Note"}</small><button aria-label={`${meta.pinned ? "Unpin" : "Pin"} experiment: ${meta.title || cell.id}`} aria-pressed={Boolean(meta.pinned)} onClick={() => { flag(cell, { pinned: !meta.pinned, ...(!meta.pinned ? { suppressed: false } : {}) }); if (!meta.pinned) onPin(); }}>{meta.pinned ? "Pinned" : "Pin"}</button>{cell.cell_type === "code" && view === "active" && <button className="primary-button" disabled={!trusted || saving || paused.current || job?.status === "working"} title={!trusted ? "Allow Python in settings first" : "Run this cell explicitly"} onClick={() => { void run(cell); }}>{job?.cellId === cell.id && job.status === "working" ? "Running…" : "Run"}</button>}</header>
          <details className="experiment-cell-actions"><summary>Organize cell</summary><div className="experiment-cell-tools"><button aria-pressed={Boolean(meta.highlighted)} onClick={() => flag(cell, { highlighted: !meta.highlighted })}>{meta.highlighted ? "★ Prioritized for questions" : "☆ Prioritize for questions"}</button><button aria-pressed={Boolean(meta.suppressed)} onClick={() => flag(cell, { suppressed: !meta.suppressed })}>{meta.suppressed ? "Show" : "Suppress"}</button>{view === "trash" ? <button onClick={() => flag(cell, { deleted: false, filed: false })}>Restore</button> : <><button onClick={() => flag(cell, { filed: !meta.filed })}>{meta.filed ? "Unfile" : "File away"}</button><button onClick={() => flag(cell, { deleted: true })}>Trash</button></>}<button aria-label="Move experiment up" disabled={index===0} onClick={()=>moveCell(cell.id,visible[index-1].id)}>↑</button><button aria-label="Move experiment down" disabled={index===visible.length-1} onClick={()=>moveCell(cell.id,visible[index+1].id,false)}>↓</button>
            <button onClick={() => add("markdown", cell.id)}>+ Note below</button><button onClick={() => add("code", cell.id)}>+ Python below</button>
            <label className="experiment-cell-folder">Folder / topic<input aria-label={`Folder for experiment: ${meta.title || cell.id}`} maxLength={200} value={meta.folder || ""} placeholder="Later" onChange={event=>flag(cell,{folder:event.target.value})}/></label>
            {images.count>0 && <details className="experiment-image-tools"><summary>Saved images · {images.count} · {imageSizeLabel(images.bytes)}</summary><p>Remove PNG images from this notebook only. Code, notes and other outputs stay. Run files, backups and evidence copies are not deleted. Undo is available while this conversation stays open.</p><button disabled={saving || paused.current || job?.status==="working"} onClick={()=>removeImages(cell.id)}>Remove saved images</button></details>}
            {imageUndo[cell.id] && <button disabled={saving || job?.status==="working"} title="Available until this conversation closes; won't overwrite changed outputs" onClick={()=>undoImages(cell.id)}>Undo image removal</button>}
          </div></details>
          {!collapsed && <><button className="experiment-source-toggle" aria-expanded={editing} onClick={() => setSourceOpen((old) => ({ ...old, [cell.id]: !editing }))}>{editing ? "Close source editor" : cell.cell_type === "code" ? "Edit code" : "Edit note"}</button>{editing && <textarea className={cell.cell_type === "code" ? "experiment-code" : ""} aria-label={cell.cell_type === "code" ? "Experiment Python source" : "Experiment note source"} title="Shift+Enter: run / preview and advance · Ctrl+Enter: stay" spellCheck={cell.cell_type !== "code"} value={cellText(cell)} rows={cell.cell_type === "code" ? 7 : 3} onFocus={() => setSourceOpen((old) => ({ ...old, [cell.id]: true }))} onChange={(event) => edit(cell.id, { source: event.target.value })} onKeyDown={event => {
            const shortcut = notebookShortcut({ ...event, isComposing: event.nativeEvent.isComposing }); if (!shortcut) return; event.preventDefault();
            void (async () => { const accepted = cell.cell_type === "code" ? await run(cell) : Boolean(await save()); if (!accepted) return; setSourceOpen(old => ({ ...old, [cell.id]: false })); if (shortcut === "advance") advance(cell.id); })();
          }} />}{cell.cell_type === "markdown" && cellText(cell) && <ReplyMarkdown text={cellText(cell)} />}
            {!!cell.outputs?.length && <>{outputChoice && <label className="experiment-display-choice">Saved display<select aria-label={`Saved display for ${meta.title || cell.id}`} value={!compact && allOutputs[cell.id] ? "all" : String(featured)} onChange={event => {
              const all = event.target.value === "all"; setAllOutputs(old => ({ ...old, [cell.id]: all })); setLinkedOutput(old => { const next = { ...old }; delete next[cell.id]; return next; }); if (!all) flag(cell, { featuredOutput: Number(event.target.value) });
            }}>{cell.outputs.map((output, i) => <option key={i} value={i}>{savedOutputLabel(output, i)}</option>)}{!compact && <option value="all">All outputs · {cell.outputs.length}</option>}</select></label>}
            {compact ? <div className="experiment-pinned-output">{stale && <small>Saved output is from earlier code; rerun explicitly to test changes.</small>}{shownOutputs.map((output, i) => <Output key={`${featured}-${i}`} output={output} />)}<LazyDisclosure summary={`All saved outputs (${cell.outputs.length})`}>{cell.outputs.map((output, i) => <Output key={i} output={output} />)}</LazyDisclosure></div> : <><button className="experiment-output-toggle" aria-expanded={!outputsHidden[cell.id]} onClick={() => setOutputsHidden((old) => ({ ...old, [cell.id]: !old[cell.id] }))}>{outputsHidden[cell.id] ? "Show" : "Hide"} saved outputs{stale ? " · from earlier code" : ""}</button>{!outputsHidden[cell.id] && shownOutputs.map((output, i) => <Output key={`${allOutputs[cell.id] ? "all" : featured}-${i}`} output={output} />)}</>}</>}
            {meta.lastRunAt && <small>Last run {new Date(meta.lastRunAt).toLocaleString()} · {experimentDuration(meta.durationMs ?? 0)} · {meta.execution?.mode === "session" ? `shared session, step ${meta.execution.sequence}` : "fresh cell"}{meta.execution?.timeoutMs ? ` · ${experimentBudgetLabel(meta.execution.timeoutMs)} limit` : ""}{stale ? ` · ${stale}` : ""}</small>}
            {meta.imagesCleared && <small>PNG images removed from this notebook. Other outputs and saved run copies are kept.</small>}
            <details><summary>Cell details</summary><small>Cell ID: {cell.id}. Hiding changes display only. Filed and trashed cells are left out of new prompts.</small></details>
          </>}
        </article>;
      })}
      {catalogueOpen && <>
      <details className="experiment-details"><summary>Jupyter & shared files</summary><p>Notebook file: <code>{path}</code></p><button disabled={!path} onClick={() => { void copyAgentInstructions(); }}>Copy instructions for an assistant</button><ResearchSetup key={entryId} projectId={projectId} entryId={entryId} /><p>Shift+Enter runs code or previews a note, then moves to the next cell. Ctrl+Enter stays here. Python permission and run limits still apply. Jump to cell also finds filed and trashed notes without restoring them.</p><p>Jupyter can open this .ipynb file. Define display helpers there if your code uses them. HTML and JavaScript outputs are kept but never executed here. Fresh cells are the default; shared sessions are optional. Run history and a previous notebook copy are kept on disk.</p></details>
    </>}
    </>}
  </section>;
});
