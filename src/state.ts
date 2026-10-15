import { defaultThemeLenses } from "./demoProject";
import type { AppState, ProgressState } from "./types";
import { freshTurbo } from "./turbo";
import { createJsonSnapshotter } from "./jsonSnapshot";
import { defaultDisplayMode, normalizeDisplayMode } from "./display";
import { normalizeBlockWindow } from "./manuscriptView";
import { initialWindowRequest, windowStateCache } from "./windowCache";

const STORAGE_KEY = "paperfocus.prototype.v1";
const snapshot = createJsonSnapshotter();

export const initialState: AppState = {
  destination: "manuscript",
  notebookEntries: [],
  suggestions: { relation: "related", minimized: true },
  turbo: freshTurbo(),
  lens: "paper",
  displayMode: defaultDisplayMode,
  sourcePresentation: "plain", // Implicit editable blocks, without explicit boxes; not the raw-file editor.
  activeNodeId: "main-result",
  focusedNodeId: "main-result",
  hiddenNodeIds: ["appendix"],
  handoffDrafts: {},
  progressByNode: {
    abstract: "done",
    intro: "done",
    motivation: "done",
    model: "progress",
    identification: "progress",
    "main-result": "progress",
    "lemma-1": "done",
    "proof-lemma-1": "done",
    "theorem-1": "progress",
    "proof-theorem-1": "progress",
    "corollary-1": "blank",
    estimation: "blank",
    appendix: "blank",
  },
  paragraphEdits: {},
  rewriteSessions: [],
  attentionTasks: [],
  themeLenses: defaultThemeLenses,
  activeThemeId: defaultThemeLenses[0].id,
  previewMode: "split",
};

export function loadState(projectId = "demo"): AppState {
  const defaults = projectId === "demo" ? structuredClone(initialState) : {
    ...structuredClone(initialState), activeNodeId: "", hiddenNodeIds: [], progressByNode: {},
    themeLenses: [], activeThemeId: "", focusedNodeId: undefined,
  };
  try {
    const raw = windowStateCache().read(projectId === "demo" ? STORAGE_KEY : `${STORAGE_KEY}.${projectId}`, !!initialWindowRequest, initialWindowRequest?.projectId === projectId ? initialWindowRequest.recoveryId : undefined);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as Partial<AppState>;
    return {
      ...defaults,
      ...stored,
      displayMode: normalizeDisplayMode(stored.displayMode),
      blockWindow: normalizeBlockWindow(stored.blockWindow),
      previewMode:
        stored.previewMode ??
        ((stored as Partial<AppState> & { previewVisible?: boolean }).previewVisible === false
          ? "hidden"
          : "split"),
      progressByNode: { ...defaults.progressByNode, ...stored.progressByNode },
      paragraphEdits: { ...defaults.paragraphEdits, ...stored.paragraphEdits },
      themeLenses: stored.themeLenses ?? defaults.themeLenses,
      rewriteSessions: stored.rewriteSessions ?? [],
      attentionTasks: stored.attentionTasks ?? [],
      hiddenWaitingNoticeIds: Array.isArray(stored.hiddenWaitingNoticeIds) ? stored.hiddenWaitingNoticeIds.filter((id) => typeof id === "string").slice(-2000) : [],
      notebookEntries: stored.notebookEntries ?? [],
      collapsedNotebookIds: Array.isArray(stored.collapsedNotebookIds) ? stored.collapsedNotebookIds.filter((id) => typeof id === "string").slice(-2000) : [],
      suggestions: { ...defaults.suggestions, ...stored.suggestions },
      turbo: { ...freshTurbo(), ...stored.turbo },
    };
  } catch {
    return defaults;
  }
}

export function saveState(state: AppState, projectId = "demo") {
  windowStateCache().write(projectId === "demo" ? STORAGE_KEY : `${STORAGE_KEY}.${projectId}`, state, snapshot(state));
}

export function hasSavedWindowState(projectId = "demo") {
  try { return windowStateCache().hasOwn(projectId === "demo" ? STORAGE_KEY : `${STORAGE_KEY}.${projectId}`); } catch { return false; }
}

export function cycleProgress(value: ProgressState): ProgressState {
  if (value === "blank") return "progress";
  if (value === "progress") return "done";
  return "blank";
}
