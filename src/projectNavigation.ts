import type { AppState, ProjectDocument } from "./types";
import type { SourceDraftCopy } from "./sourceRefresh";

export function navigationDraftKey(state: AppState) {
  return JSON.stringify([state.draftRevision, state.draftMainFile, state.paragraphEdits, state.sourceSaveContinuation]);
}

/** Preserve literal edits, including orphan IDs, without guessing a new source location. */
export function navigationDraftCopy(document: ProjectDocument, state: AppState): Omit<SourceDraftCopy, "id" | "createdAt"> | undefined {
  const drafts = Object.entries(state.paragraphEdits).map(([paragraphId, draftText]) => {
    const range = state.sourceSaveContinuation?.ranges.find(item => item.paragraphId === paragraphId);
    const original = !state.draftMainFile || state.draftMainFile === document.project.mainFile ? document.paragraphs.find(item => item.id === paragraphId) : undefined;
    const trusted = state.draftRevision === document.revision && (!state.draftMainFile || state.draftMainFile === document.project.mainFile);
    return { paragraphId, draftText, file: range?.file ?? original?.file,
      baseText: range?.text ?? (trusted ? original?.text : undefined),
      reason: !trusted ? "unknown-base" as const : original ? "changed" as const : "missing" as const };
  });
  if (!drafts.length) return undefined;
  return { version: 1, projectId: document.project.id, rootFile: state.draftMainFile ?? document.project.mainFile,
    baseRevision: state.draftRevision ?? "unknown", incomingRevision: document.revision, drafts };
}

export function finishNavigationDraft(state: AppState, archivedKey: string) {
  if (navigationDraftKey(state) !== archivedKey) throw new Error("The draft changed while opening the paper. Try again; the new edit is still here.");
  return { ...state, paragraphEdits: {}, draftRevision: undefined, draftMainFile: undefined, sourceSaveContinuation: undefined };
}

/** Saving is best effort for navigation, but preserving a failed draft is mandatory. */
export async function prepareProjectNavigation(document: ProjectDocument, readDraft: () => AppState,
  save: () => Promise<ProjectDocument>, persist: (state: AppState) => void,
  archive: (copy: Omit<SourceDraftCopy, "id" | "createdAt">) => Promise<void>) {
  persist(readDraft());
  try { await save(); return undefined; }
  catch (error) {
    const state = readDraft(), copy = navigationDraftCopy(document, state);
    if (!copy) throw error;
    const key = navigationDraftKey(state);
    await archive(copy);
    // Do not clear the editor yet: opening the destination might itself fail.
    if (navigationDraftKey(readDraft()) !== key) throw new Error("The draft changed while it was being kept. Try opening the paper again.");
    return key;
  }
}

export function sourceFileTarget(document: ProjectDocument, file: string) {
  const paragraph = document.paragraphs.find(item => item.file === file);
  const node = paragraph ? document.nodes.find(item => item.id === paragraph.nodeId)
    : document.nodes.find(item => item.sourceInsertion?.file === file);
  return node ? { nodeId: node.id, paragraphId: paragraph?.id ?? node.paragraphIds[0] } : undefined;
}

export function manuscriptSourceFiles(document: ProjectDocument) {
  return [...new Set([document.project.mainFile, ...(document.sourceFiles ?? []), ...document.paragraphs.flatMap(p => p.file ? [p.file] : [])])]
    .filter(file => file.endsWith(".tex"));
}
