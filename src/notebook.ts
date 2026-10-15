import type { AppState, AttentionTask, ManuscriptNode, NotebookEntry, Paragraph, PendingSelection, ProjectDocument, TaskSourceSnapshot } from "./types.ts";
import { fingerprint as textFingerprint } from "./rewrite.ts";
import { queueAttentionTask } from "./attention.ts";
import { checkTaskSource } from "./taskSource.ts";
import { locateSavedPassage } from "./sourceRefresh.ts";
import { notebookExcerpt, notebookSurroundingSource } from "./selectionPassages.ts";
import { windowWorkspaceUrl } from "./windowWorkspace.ts";
import { manuscriptPurpose, manuscriptWritingPolicy } from "./manuscripts.ts";

/** Read the exact catalogue header written by existing phase rollovers. Never
 * follow authored URLs or infer ancestry from titles/conversation order. */
export function phasePredecessor(entry: NotebookEntry, projectId: string): string | undefined {
  if (entry.recoveryKey) return;
  const match = /^Research phase checkpoint; previous phase: (\S+)\r?\n/.exec(entry.notes);
  if (!match) return;
  try {
    const url = new URL(match[1]);
    if (!['http:', 'https:'].includes(url.protocol) || url.searchParams.get('awProject') !== projectId
      || url.searchParams.get('awPanel') !== 'notebook') return;
    const id = url.searchParams.get('awNotebook');
    return id && id !== entry.id ? id : undefined;
  } catch { return; }
}

export function phaseNeighbours(entry: NotebookEntry, entries: NotebookEntry[], projectId: string) {
  const eligible = entries.filter(item => !item.recoveryKey);
  const previousId = phasePredecessor(entry, projectId);
  return {
    previous: eligible.find(item => item.id === previousId),
    next: eligible.filter(item => phasePredecessor(item, projectId) === entry.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
  };
}

/** Include archived ancestors without labelling unrelated questions as phases. */
export function researchPhases(entries: NotebookEntry[], projectId: string) {
  const eligible = entries.filter(item => !item.recoveryKey);
  const parents = new Set(eligible.map(item => phasePredecessor(item, projectId)).filter(Boolean));
  return eligible.filter(item => parents.has(item.id) || phasePredecessor(item, projectId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Inspect archives without restoring or changing their notebook ownership. */
export function phaseSelection<T extends { activeNotebookId?: string; collapsedNotebookIds?: string[] }>(state: T, id: string): T {
  return { ...state, activeNotebookId: id, collapsedNotebookIds: (state.collapsedNotebookIds ?? []).filter(item => item !== id) };
}

export async function navigateSavedPhase(save: () => Promise<unknown>, select: () => void) {
  await save();
  select();
}

/** A normal project open resumes the newest saved phase, not a cached archive.
 * Explicit evidence/recovery links and later polling retain human selection. */
export function openResearchPhase(current: AppState, entries: NotebookEntry[], projectId: string,
  options: { entryId?: string; recovery?: boolean; showNotebook?: boolean } = {}): AppState {
  if (options.recovery) return current;
  const phases = researchPhases(entries, projectId);
  const active = phases.filter(item => !item.filed);
  const target = options.entryId ? entries.find(item => item.id === options.entryId && !item.recoveryKey) : (active.length ? active : phases).at(-1);
  if (!target) return current;
  const selected = phaseSelection(current, target.id);
  return options.showNotebook ? { ...selected, destination: "notebook" } : selected;
}

export { thinkingLevels as researchEfforts } from "./workspaceTools.ts";
import { thinkingLevels as researchEfforts } from "./workspaceTools.ts";

export function newNotebookEntry(document: ProjectDocument, state: AppState, selection?: PendingSelection): NotebookEntry {
  const paragraph = document.paragraphs.find((p) => p.id === selection?.paragraphId);
  const text = paragraph ? state.paragraphEdits[paragraph.id] ?? paragraph.text : "";
  const now = new Date().toISOString();
  const start = selection?.start ?? 0;
  const end = selection?.end ?? text.length;
  const node = document.nodes.find((n) => n.id === paragraph?.nodeId);
  const passages = selection?.spans?.map(span => {
    const p = document.paragraphs.find(p => p.id === span.paragraphId);
    const value = p && (state.paragraphEdits[p.id] ?? p.text);
    if (!p || value === undefined || value.slice(span.start, span.end) !== span.text) throw new Error("A highlighted block changed. Highlight it again before asking.");
    return { rootFile: document.project.mainFile, paragraphId: p.id, nodeId: p.nodeId, nodeTitle: document.nodes.find(n => n.id === p.nodeId)?.title ?? "Passage", file: p.file, revision: document.revision,
      paragraphText: value, start: span.start, end: span.end, excerpt: span.text,
      duplicateAtCapture: document.paragraphs.filter(q => q.file === p.file && (state.paragraphEdits[q.id] ?? q.text) === value).length > 1 };
  });
  return {
    id: crypto.randomUUID(), title: paragraph ? `Question · ${node?.title ?? "Passage"}` : "New question",
    manuscriptFile: document.project.mainFile,
    question: "", notes: "", reply: "", proposal: "", status: "open", route: "local", effort: 2,
    handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now,
    source: paragraph ? { rootFile: document.project.mainFile, paragraphId: paragraph.id, nodeId: paragraph.nodeId, nodeTitle: node?.title ?? "Passage", file: paragraph.file,
      revision: document.revision, paragraphText: text, start, end, excerpt: text.slice(start, end),
      ...(passages ? { passages } : {}),
      duplicateAtCapture: document.paragraphs.filter((p) => p.file === paragraph.file && (state.paragraphEdits[p.id] ?? p.text) === text).length > 1 } : undefined,
    returnView: { lens: state.lens, focusedNodeId: state.focusedNodeId, previewMode: state.previewMode, turboEnabled: state.turbo.enabled, turboCursor: state.turbo.activeParagraphId, blockWindow: state.blockWindow },
  };
}

export function toggleNotebookConversation(state: AppState, id: string, open: boolean): AppState {
  if (!state.notebookEntries.some((entry) => entry.id === id)) return state;
  return { ...state, activeNotebookId: open ? id : state.activeNotebookId,
    collapsedNotebookIds: open ? (state.collapsedNotebookIds ?? []).filter((item) => item !== id) : [...new Set([...(state.collapsedNotebookIds ?? []), id])],
    notebookEntries: state.notebookEntries.map((entry) => entry.id===id && (open ? entry.filed : entry.pinned) ? { ...entry,...(open?{filed:false}:{pinned:false}),updatedAt:new Date().toISOString() } : entry) };
}

export function notebookTitle(entry: NotebookEntry): string {
  return entry.title === "New question" || entry.title.startsWith("Question · ")
    ? entry.question.trim().split("\n")[0].slice(0, 72) || entry.title : entry.title;
}

/** Navigation links use the same conservative anchors as Return to passage.
 * Include every captured block and filed conversations, but not recovery copies.
 * This is a view lookup: it never refreshes excerpts or marks work complete. */
export function notebookEntriesForPassage(entries: NotebookEntry[], document: ProjectDocument, edits: Record<string, string>, paragraphId?: string): NotebookEntry[] {
  const paragraph = document.paragraphs.find(p => p.id === paragraphId);
  if (!paragraph) return [];
  return entries.filter(entry => !entry.recoveryKey && entry.source && [entry.source, ...(entry.source.passages ?? [])].some(source =>
    (source.returnAnchor?.file ?? source.file) === paragraph.file && locateSavedPassage(source, document, edits)?.id === paragraph.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

/** Display availability only: never read/approve a reply or complete its queue item. */
export function notebookReplyStatus(entry: NotebookEntry): "answer" | "waiting" | "none" {
  const turn = entry.study?.turns.find(turn => turn.id === entry.study?.activeTurnId) ?? entry.study?.turns.at(-1);
  if (turn) {
    if (turn.status === "ready" && (turn.reply.trim() || turn.answer && Object.values(turn.answer).some(value => typeof value === "string" && value.trim()))) return "answer";
    if (turn.status === "queued" && !turn.closed && !turn.completedExternally) return "waiting";
    return "none";
  }
  return entry.reply.trim() ? "answer" : "none";
}

/** New tabs open saved source, not a different window's unsaved draft. */
export function notebookPassageUrl(base: string, entry: NotebookEntry, document: ProjectDocument, state: AppState): string | undefined {
  if (entry.source?.rootFile && entry.source.rootFile !== document.project.mainFile) {
    const source = entry.source.returnAnchor ?? entry.source;
    const url = new URL(windowWorkspaceUrl(base, document, { ...state, activeNodeId: entry.source.nodeId, activeParagraphId: source.paragraphId, activeNotebookId: entry.id }, "paper", "reading"));
    url.searchParams.set("awRoot", entry.source.rootFile); url.searchParams.set("awRevision", source.revision); return url.href;
  }
  const paragraph = locateSavedPassage(entry.source, document, {});
  if (!paragraph) return undefined;
  return windowWorkspaceUrl(base, document, { ...state, activeNodeId: paragraph.nodeId, activeParagraphId: paragraph.id, activeNotebookId: entry.id }, "paper", "reading");
}

/** Queue navigation prefers a linked manuscript; standalone/uncertain questions stay in the notebook. */
export function notebookQueuePassage(task: AttentionTask, document: ProjectDocument, state: AppState): Paragraph | undefined {
  const entry = state.notebookEntries.find(entry => entry.id === task.notebookId);
  return entry && locateSavedPassage(entry.source, document, state.paragraphEdits);
}

/** Track the captured paragraph, never silently substitute newer manuscript text. */
export function notebookTaskSource(entry: NotebookEntry, document: ProjectDocument): TaskSourceSnapshot | undefined {
  const source = entry.source;
  if (!source) return undefined;
  const sources = source.passages ?? [source];
  return { version: 1, projectId: document.project.id, rootFile: source.rootFile ?? document.project.mainFile, revision: source.revision,
    returnAnchor: source.returnAnchor,
    scope: "paragraph", nodeId: source.nodeId, nodeTitle: source.nodeTitle, focusParagraphId: source.paragraphId,
    ...(sources.reduce((n, p) => n + p.paragraphText.length, 0) > 100_000 ? { paragraphs: [], unavailableReason: "oversized" as const } : { paragraphs: [...new Map(sources.map(p => [p.paragraphId, { id: p.paragraphId, nodeId: p.nodeId, file: p.file, text: p.paragraphText, duplicateAtCapture: p.duplicateAtCapture }])).values()] }) };
}

// Conservative source guard: unrelated edits are fine; a changed origin requires review.
export function proposalReplacement(entry: NotebookEntry, currentText: string | undefined) {
  const source = entry.source;
  if (!source) return { error: "This question isn't linked to a manuscript passage." };
  if (source.passages) return { error: "This question includes several blocks. Use Rephrase on the selection, or edit individual blocks, to keep their boundaries intact." };
  if (currentText === undefined) return { error: "The passage is no longer in this paper." };
  if (currentText !== source.paragraphText || currentText.slice(source.start, source.end) !== source.excerpt) {
    return { error: "The paragraph changed. Review it and refresh the link in Details before replacing text." };
  }
  if (!entry.proposal.trim()) return { error: "Add proposed LaTeX text first." };
  return { text: currentText.slice(0, source.start) + entry.proposal + currentText.slice(source.end) };
}

export function notebookPacket(entry: NotebookEntry, project: ProjectDocument["project"]) {
  const root = entry.manuscriptFile ?? entry.source?.rootFile ?? project.mainFile;
  const purpose = manuscriptPurpose(project, root);
  return ["# Active Writing · notebook question", `Destination: ${entry.route}; requested effort: ${researchEfforts[entry.effort] ?? "Medium"}`,
    "Choose a model and effort level in your other app. Nothing is sent automatically.", "", "## Question", entry.question || entry.title,
    "", "## Linked passage", notebookExcerpt(entry.source) || "No manuscript passage: a standalone question.",
    "", "## Surrounding source (context only)", notebookSurroundingSource(entry.source), "", "## Working notes", entry.notes,
    ...(entry.experimentContext ? ["", "## Experiments (not proof)", entry.experimentContext] : []),
    "", "## Project", `${project.folder}/${root}`, manuscriptWritingPolicy(purpose), `Source file: ${entry.source?.file ?? "not linked"}`,
    ...(purpose === "overview" ? [`Main manuscript: ${project.manuscriptOverviewTargets?.[root] ?? "not designated; ask rather than guessing"}`] : []),
    `Saved source version: ${entry.source?.revision ?? "not linked"}`,
    "", "Preserve the intended result and hypotheses. Distinguish evidence, speculation, failed checks, and proposed changes.",
    purpose === "overview" ? "Keep collaborator overviews short and explanatory; point to the designated main manuscript for details. Source writing still needs human scope." : purpose === "notes" ? "A requested explanatory note may be full-length. Source writing still requires the human's explicit scope; otherwise return the explanation here. Preserve human text, locks, and publication files." : "Suggest a concrete next check. Publication changes go through the incremental writing workflow, not whole-paper replacement.",
    "Do not mark claims verified. Receiving an answer never approves text or resolves human comments."].join("\n");
}

export function branchId(nodes: ManuscriptNode[], nodeId?: string, index?: Map<string, ManuscriptNode>): string | undefined {
  let node = index ? index.get(nodeId ?? "") : nodes.find((n) => n.id === nodeId);
  const visited = new Set<string>();
  while (node?.parentId && !visited.has(node.id)) {
    visited.add(node.id);
    const parent = index ? index.get(node.parentId) : nodes.find((n) => n.id === node!.parentId);
    if (!parent || parent.id === "document") break;
    node = parent;
  }
  return node?.id;
}

export interface WorkSuggestion { kind: "paragraph" | "notebook"; id: string; title: string; detail: string; nodeId?: string }

export function suggestWork(document: ProjectDocument, state: AppState): WorkSuggestion | undefined {
  const nodeMap = new Map(document.nodes.map((node) => [node.id, node]));
  const branches = new Map<string | undefined, string | undefined>();
  const branchFor = (id?: string) => { if (!branches.has(id)) branches.set(id, branchId(document.nodes, id, nodeMap)); return branches.get(id); };
  const activeEntry = state.notebookEntries.find((e) => e.id === state.activeNotebookId);
  const origin = state.destination === "notebook" ? activeEntry?.source?.nodeId : state.activeNodeId;
  const branch = branchFor(origin);
  const related = state.suggestions.relation === "related";
  const matches = (nodeId?: string) => related ? Boolean(branch && branchFor(nodeId) === branch) : !branch || branchFor(nodeId) !== branch;
  const tasks = state.attentionTasks.filter((t) => ["queued", "working", "ready"].includes(t.status));
  const assignedParagraphs = new Set<string>();
  const assignedSections = new Set<string>();
  for (const task of tasks) {
    if (task.sourceSnapshot) {
      const snapshot = task.sourceSnapshot;
      if (snapshot.projectId !== document.project.id || snapshot.rootFile !== document.project.mainFile) continue;
      // A captured section is occupied as a subtree, not just its first paragraph.
      // This conservative scheduling exclusion is not source reattachment or an edit guard.
      if (snapshot.scope === "section") assignedSections.add(snapshot.nodeId);
      const check = checkTaskSource(snapshot, document, state.paragraphEdits);
      for (const match of check.matches) if (match.after && ["unchanged", "relocated"].includes(match.state)) assignedParagraphs.add(match.after.id);
    } else if (!task.paragraphId && !task.notebookId) assignedSections.add(task.nodeId);
    else {
      const entry = state.notebookEntries.find((item) => item.id === task.notebookId);
      const passage = entry?.source ? locateSavedPassage(entry.source, document, state.paragraphEdits)
        : document.paragraphs.find((p) => p.id === task.paragraphId && p.nodeId === task.nodeId);
      if (passage) assignedParagraphs.add(passage.id);
    }
  }
  const assigned = (p: Paragraph) => {
    if (assignedParagraphs.has(p.id)) return true;
    if (!assignedSections.size) return false;
    let node = nodeMap.get(p.nodeId);
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      if (assignedSections.has(node.id)) return true;
      seen.add(node.id); node = nodeMap.get(node.parentId ?? "");
    }
    return false;
  };
  const hidden = (nodeId: string) => {
    if (!state.hiddenNodeIds.length) return false;
    let node = nodeMap.get(nodeId);
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      if (state.hiddenNodeIds.includes(node.id)) return true;
      seen.add(node.id); node = nodeMap.get(node.parentId ?? "");
    }
    return false;
  };
  const entry = state.notebookEntries.find((e) => {
    if (e.filed || e.id === state.activeNotebookId || e.status !== "open" || !matches(e.source?.nodeId) || tasks.some((t) => t.notebookId === e.id)) return false;
    const passage = locateSavedPassage(e.source, document, state.paragraphEdits);
    return !passage || !assigned(passage);
  });
  if (state.destination === "notebook" && entry) return { kind: "notebook", id: entry.id, title: entry.title, detail: "Continue an open question", nodeId: entry.source?.nodeId };
  const cursor = state.destination === "notebook" ? activeEntry?.source?.paragraphId : state.turbo.enabled ? state.turbo.activeParagraphId
    : state.activeParagraphId ?? document.paragraphs.find((p) => p.nodeId === state.activeNodeId)?.id;
  const index = document.paragraphs.findIndex((p) => p.id === cursor);
  const ordered = [...document.paragraphs.slice(index + 1), ...document.paragraphs.slice(0, index + 1)];
  const paragraph = ordered.find((p: Paragraph) => p.id !== cursor && matches(p.nodeId) && !hidden(p.nodeId)
    && !/^\s*(?:\\(?:tableofcontents|maketitle|bibliography|bibliographystyle|printbibliography|title|author|date|documentclass|usepackage)\b|\\(?:begin|end)\s*\{document\})/.test(p.text)
    && state.progressByNode[p.nodeId] !== "done" && !assigned(p)
    && (!state.turbo.enabled || state.turbo.includeTechnical || !/^\s*\\(?:begin|end|maketitle|bibliography|\[)/.test(p.text))
    && (!state.turbo.enabled || state.turbo.reviews[p.id]?.fingerprint !== textFingerprint(state.paragraphEdits[p.id] ?? p.text))
    && (state.lens !== "proofs" || ["theorem", "lemma", "corollary", "proof"].includes(nodeMap.get(p.nodeId)?.kind ?? "")));
  if (paragraph) return { kind: "paragraph", id: paragraph.id, nodeId: paragraph.nodeId,
    title: nodeMap.get(paragraph.nodeId)?.title ?? "Passage", detail: related ? "Same section · continue a passage" : "Different section · work in parallel" };
  return entry ? { kind: "notebook", id: entry.id, title: entry.title, detail: "Continue an open question", nodeId: entry.source?.nodeId } : undefined;
}

/** Include a just-exported task before React commits it; fallback is explicit to the caller. */
export function nextWork(document: ProjectDocument, state: AppState, pendingTask?: AttentionTask): { suggestion: WorkSuggestion | undefined; relation: AppState["suggestions"]["relation"]; fallback: boolean } {
  const current = pendingTask ? queueAttentionTask(state, pendingTask) : state;
  const relation = current.suggestions.relation;
  const preferred = suggestWork(document, current);
  if (preferred) return { suggestion: preferred, relation, fallback: false };
  const alternative = relation === "related" ? "unrelated" : "related";
  return { suggestion: suggestWork(document, { ...current, suggestions: { ...current.suggestions, relation: alternative } }), relation: alternative, fallback: true };
}

