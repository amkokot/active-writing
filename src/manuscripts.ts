import type { AppState, ManuscriptPurpose, NotebookEntry, PaperProject } from "./types.ts";

export function manuscriptPurpose(project: PaperProject, file = project.mainFile): ManuscriptPurpose {
  const purpose = project.manuscriptPurposes?.[file];
  return purpose === "publication" || purpose === "overview" ? purpose : "notes";
}
export function manuscriptWritingPolicy(purpose: ManuscriptPurpose) {
  if (purpose === "overview") return "Overview (README): keep it short, clear and explanatory, usually a few paragraphs or one page rather than a full research note. Explain the aim, the main idea, current status and how to read the project; link to the designated main manuscript and exact evidence for details. Use plain language, define necessary terms, and distinguish established results from evidence and open questions. A coherent first draft is welcome when source writing is authorized; publication's incremental word-by-word review is not required. Preserve human work and existing wording locks. Do a focused readability check, not exhaustive typesetting or proof verification. Never expand this overview into the full manuscript.";
  return purpose === "notes"
    ? "Research notes: when the user requests source writing, a full explanation, derivation or digest is welcome at whatever length is useful. No three-paragraph limit or word-by-word approval is required. Preserve human work and any existing wording locks; distinguish established results, evidence and open gaps. During exploration use minimal editing/rendering checks. When the human makes clear that this version is intended to be read, do a focused readability/rendering pass without requiring a formal QA request. This is not publication polish or mathematical validation."
    : "Publication draft: propose one idea through one to three connected paragraphs using the incremental writing workflow. Every changed word requires human review; approved wording stays locked. Do not bypass the review queue with direct source writes. This cap concerns publication prose, not full research explanations in the notebook.";
}

export function manuscriptVersionLabel(project: PaperProject, file: string) {
  const version = project.manuscriptVersions?.find(item => item.file === file);
  return `v.${version?.number ?? 1}`;
}
export function nextManuscriptVersion(project: PaperProject) {
  const current = project.manuscriptVersions?.find(item => item.file === project.mainFile);
  const number = Math.max(1, ...(project.manuscriptVersions ?? []).filter(item => item.family === current?.family).map(item => item.number)) + 1;
  const base = (current?.family ?? project.mainFile).replace(/\.tex$/i, "");
  return { file: `${base}-v${number}.tex`, number };
}
export function notebookForManuscript(entries: NotebookEntry[], file: string) {
  return entries.filter(entry => !entry.manuscriptFile || entry.manuscriptFile === file);
}

export type ManuscriptKind = "notes" | "overview" | "paper";
export type ManuscriptView = Pick<AppState, "activeNodeId" | "activeParagraphId" | "focusedNodeId" | "hiddenNodeIds" | "collapsedNodeIds" | "progressByNode">;
export function manuscriptView(state: AppState): ManuscriptView {
  const { activeNodeId, activeParagraphId, focusedNodeId, hiddenNodeIds, collapsedNodeIds, progressByNode } = state;
  return { activeNodeId, activeParagraphId, focusedNodeId, hiddenNodeIds, collapsedNodeIds, progressByNode };
}
export function restoreManuscriptView(state: AppState, view?: ManuscriptView): AppState {
  return { ...state, activeNodeId: "", activeParagraphId: undefined, focusedNodeId: undefined, hiddenNodeIds: [], collapsedNodeIds: undefined,
    progressByNode: {}, ...view, blockWindow: undefined, handoffResume: undefined, turbo: { ...state.turbo, enabled: false, activeParagraphId: undefined } };
}
export function parseManuscriptView(value: unknown): ManuscriptView | undefined {
  const v = value as ManuscriptView;
  const id = (s: unknown) => typeof s === "string" && s.length <= 2000;
  const ids = (a: unknown) => Array.isArray(a) && a.length <= 5000 && a.every(id);
  if (!v || !id(v.activeNodeId) || v.activeParagraphId !== undefined && !id(v.activeParagraphId) || v.focusedNodeId !== undefined && !id(v.focusedNodeId)
    || !ids(v.hiddenNodeIds) || v.collapsedNodeIds !== undefined && !ids(v.collapsedNodeIds) || !v.progressByNode || typeof v.progressByNode !== "object"
    || Array.isArray(v.progressByNode) || Object.entries(v.progressByNode).length > 5000
    || Object.entries(v.progressByNode).some(([key, progress]) => !id(key) || !["blank", "progress", "done"].includes(progress))) return;
  return { activeNodeId: v.activeNodeId, activeParagraphId: v.activeParagraphId, focusedNodeId: v.focusedNodeId, hiddenNodeIds: v.hiddenNodeIds,
    collapsedNodeIds: v.collapsedNodeIds, progressByNode: v.progressByNode };
}
export function latexText(value: string) {
  const escapes: Record<string, string> = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "#": "\\#", "$": "\\$", "&": "\\&", "_": "\\_", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}" };
  return value.replace(/[\\{}%#$&_^~]/g, c => escapes[c]);
}
export function newManuscript(file: string, title: string, kind: ManuscriptKind) {
  const path = file.trim(), name = title.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.tex$/.test(path) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(path)) throw new Error("Use a simple filename ending in .tex, such as research-notes.tex.");
  if (!name || name.length > 200 || /[\r\n\x00-\x1f]/.test(name)) throw new Error("Use a one-line title of 1–200 characters.");
  if (!["notes", "overview", "paper"].includes(kind)) throw new Error("Choose research notes, overview or paper.");
  const sections = kind === "overview" ? "% A short collaborator-facing overview, not a full research note.\n\\section*{At a glance}\nExplain the aim and the main idea in a short paragraph.\n\n\\section*{Current status}\nSummarize what is established and what remains open.\n\n\\section*{Read more}\nPoint to the main manuscript and useful evidence. Replace this with a shareable paper link when distributing the overview."
    : kind === "notes" ? "\\section{Current question}\nState the target and assumptions here.\n\n\\section{Results and evidence}\nSeparate established results, numerical evidence, and conjectures.\n\n\\section{Open questions}\nRecord the next unresolved step."
    : "\\section{Introduction}\nStart writing here.";
  return { path, source: `\\documentclass{article}\n\\usepackage{amsmath,amssymb,amsthm,graphicx,hyperref}\n\\newtheorem{theorem}{Theorem}[section]\n\\newtheorem{lemma}[theorem]{Lemma}\n\\newtheorem{proposition}[theorem]{Proposition}\n\\title{${latexText(name)}}\n\\author{}\n\\date{}\n\\begin{document}\n\\maketitle\n\n${sections}\n\n\\end{document}\n` };
}
