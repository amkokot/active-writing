import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PaneDivider, usePaneSplit } from "./components/PaneDivider";
import { useSourceLines } from "./useSourceLines";
import type { SourceCommandRange, SourceCommandEditing } from "./components/SourceCommand";
import { appName, appInitials } from "./brand";
import { loadDocument } from "./loadDocument";
import { useStableEvent } from "./useStableEvent";
import { createHoverIntent } from "./hoverIntent";
import { orderedNotebookEntries, moveNotebookEntry, fileNotebookEntry } from "./notebookCatalogue";
import { useDismissibleLayer } from "./useDismissibleLayer";
import { useMediaQuery } from "./useMediaQuery";
import { chromePreferencesKey, loadChromePreferences, saveChromePreferences } from "./chromePreferences";
import { useStoredPaneZoom } from "./usePaneZoom";
import { ToolbarDetails } from "./components/ToolbarDetails";
import { ManuscriptSwitcher } from "./components/ManuscriptSwitcher";
import { PdfDownload } from "./components/PdfDownload";
import { SourceZipDownload } from "./components/SourceZipDownload";
import { CollaboratorDownload } from "./components/CollaboratorDownload";
import { manuscriptPurpose, manuscriptView, restoreManuscriptView, newManuscript, notebookForManuscript, type ManuscriptKind } from "./manuscripts";
import { flushProjectExperimentDrafts } from "./experimentDrafts";
import { navigateSavedPhase, phaseSelection, openResearchPhase } from "./notebook";
import { manuscriptPassageUrl, workspaceBackLink } from "./researchLinks";
import { editorFont } from "./paperAppearance";
import { displayModes } from "./display";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns2,
  Eye,
  FileText,
  FolderOpen,
  ListTree,
  Link2,
  MessageSquareText,
  Maximize2,
  Scan,
  MoreHorizontal,
  Moon,
  Play,
  Pin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  SlidersHorizontal,
  TriangleAlert,
  Type,
  X,
  Zap,
} from "lucide-react";
import { Manuscript } from "./components/Manuscript";
import { PlainSourceEditor } from "./components/PlainSourceEditor";
import { Outline } from "./components/Outline";
import { defaultHandoff, initialCollapsed } from "./workspaceTools";
import { Preview } from "./components/Preview";
import { ThemeWorkspace } from "./components/ThemeWorkspace";
import { TurboBar } from "./components/TurboBar";
import { PriorityQueue } from "./components/PriorityQueue";
import { NotebookLink } from "./components/NotebookLink";
import { HandoffNotice } from "./components/HandoffNotice";
import { WorkspaceTools } from "./components/WorkspaceTools";
import { WorkspaceFolders } from "./components/WorkspaceFolders";
import { archiveAttentionTask, archiveReadyNotebookTasks, attentionQueue, attentionTaskLocation, attentionTurnNumber, canFinishWithoutImport, finishWithoutImport, moveAttentionTask, queueAttentionTask, readyResponseArrivals, rememberDeferredTasks, replyReturnBookmark, reopenAttentionTask, resetQueueColors, waitingPasteHandoffs } from "./attention";
import { exportHandoff, fetchHandoffTicket, receiveHandoffReply, refreshHandoffTicket } from "./handoffs";
import { useHandoffReplies } from "./useHandoffReplies";
import { useReviewPackets } from "./useReviewPackets";
import { newNotebookEntry, nextWork, notebookEntriesForPassage, notebookPassageUrl, notebookQueuePassage, notebookReplyStatus, notebookTaskSource, notebookTitle, proposalReplacement, suggestWork, toggleNotebookConversation } from "./notebook";
import { studyActions, studyState } from "./study";
import { useNotebookPersistence } from "./useNotebookPersistence";
import { useWorkbenchPersistence } from "./useWorkbenchPersistence";
import { useQueueActivity } from "./useQueueActivity";
import { useProjectQueue } from "./useProjectQueue";
import { loadQueueView, moveProjectQueue, projectQueueId, queueViewKey, scopedProjectQueue, touchQueueView } from "./projectQueue";
import type { ProjectQueueTask } from "./projectQueue";
import { useIdleCompilation } from "./useIdleCompilation";
import { ManuscriptBuildCache, manuscriptBuildIdentity, manuscriptBuildScope, matchingManuscriptBuild } from "./manuscriptBuildCache";
import { restoreWorkbenchDraft, rewriteSourceMatches } from "./workbench";
import { editReviewComment, makeCommandReviewComment, makeReviewComment, makeReviewCommentReply, makeReviewRequest, resolveReviewComment, resolveQueuedReviewComments, reviewSnapshot, reviewCommentTarget, reviewCommentLocation, nextCommentAfterResolve, blockReviewComments } from "./review";
import { acceptWritingParagraph, dropWritingParagraph, editWritingDraft, editWritingFeedback, makeWritingRequest, placeWritingDraft, reconcileWritingReviews, writingRoundTheme, writingSnapshot, writingLocks, writingDecisions, writingMarkers, unlockWritingParagraph } from "./writing";
import { WorkbenchStatus } from "./components/WorkbenchStatus";
import { checkTaskSource, taskSourceTarget } from "./taskSource";
import { useSourceMonitor } from "./useSourceMonitor";
import { anchorAppliedNotebookEntries, automaticSourceRefresh, locateSavedPassage, refreshSourceState, sourceRefreshPlan, SourceSaveConflict } from "./sourceRefresh";
import type { SourceDraftCopy } from "./sourceRefresh";
import { SourceRefresh } from "./components/SourceRefresh";
import { editableCaret, editableText, restoreEditableCaret } from "./editableText";
import { hasTrailingLineBreak } from "./sourceChunks";
import type { ChunkAction, ParagraphJoinUndo } from "./sourceChunks";
import { emptyChunkHasContext } from "./sourceAnchors";
import { reconcileEditorSave } from "./acknowledgedSave";
import { preserveEnvironmentMarks, wrapSourceBlock, validateEnvironmentFields } from "./environmentEditing";
import type { EnvironmentFields } from "./environmentEditing";
import type { BlockTypes } from "./environmentEditing";
import type { QueuedPassage } from "./queueEntries";
import type { SavedCaret } from "./acknowledgedSave";
import { finishNavigationDraft, prepareProjectNavigation, sourceFileTarget } from "./projectNavigation";
import { checkParagraph, turboWindows, scrollTurbo, reviewed, turboPass, undoCheck } from "./turbo";
import { adjacentManuscriptSection, chooseManuscriptScope, locateSourcePassage, manuscriptBlockWindow, manuscriptScope } from "./manuscriptView";
import type { SourceJumpTarget, SourceViewportPosition } from "./sourceViewport";
import { BlockWindowBar } from "./components/BlockWindowBar";
import { referenceTokens } from "./references";
import { createRewriteSession, effortLabels, fingerprint, generateRuleCandidates, generateSelectionCandidates, sameProtectedLatex } from "./rewrite";
import { selectedRewriteEdits, selectionPassages, verifySelection } from "./selectionPassages";
import { rankRelevantParagraphs, themeNameFromSelection } from "./similarity";
import { hasSavedWindowState, loadState, saveState } from "./state";
import { saveBrowserRecovery } from "./browserRecovery";
import { applyWindowRequest, automaticLinkedManuscript, listWindowRecoveries, resetCompanionSession, windowWorkspaceUrl } from "./windowWorkspace";
import type { WindowPanel } from "./windowWorkspace";
import { initialWindowRequest, sharedRecoveryStorage } from "./windowCache";
import { flushLargerRecovery, largerRecoveryStatus, subscribeLargerRecovery } from "./largerBrowserRecovery";
import { windowStateCache } from "./windowCache";
import { parseWorkspaceResume, rememberProject, resumeKey, startupProject } from "./workspaceResume";
import { announceSaved, subscribeWindowMessages, workspaceWindowId } from "./windowMessages";
import { useWindowWorkspace } from "./useWindowWorkspace";
import { cycleQueuedProgress, passageBookmark, sectionReminderTarget, togglePassageBookmarks } from "./queueEntries";
import { localModelForEffort } from "./components/LocalModelPicker";
import type {
  AppState,
  AttentionTask,
  CompileMode,
  CompileResult,
  CompileStatus,
  Lens,
  PendingSelection,
  RewriteCandidate,
  RewriteSession,
  ProjectDocument,
  Paragraph,
  DocumentLabel,
  ReferenceRequest,
  TurboState,
  NotebookEntry,
  StudyTurn,
  HandoffTicket,
  TaskSourceSnapshot,
  ManuscriptScope,
  WritingScope,
} from "./types";

// Keep the editor available before optional research/math and inspector tools load.
const ResearchNotebook = lazy(() => import("./components/ResearchNotebook").then((module) => ({ default: module.ResearchNotebook })));
const ManuscriptPrompt = lazy(() => import("./components/ManuscriptPrompt").then((module) => ({ default: module.ManuscriptPrompt })));
const ReferenceDrawer = lazy(() => import("./components/ReferenceDrawer").then((module) => ({ default: module.ReferenceDrawer })));
const HandoffReply = lazy(() => import("./components/HandoffReply").then((module) => ({ default: module.HandoffReply })));
const RewriteDrawer = lazy(() => import("./components/RewriteDrawer").then((module) => ({ default: module.RewriteDrawer })));
const AgentHandoff = lazy(() => import("./components/AgentHandoff").then((module) => ({ default: module.AgentHandoff })));
const LatexAssistant = lazy(() => import("./components/LatexAssistant").then((module) => ({ default: module.LatexAssistant })));
const RepositoryPanel = lazy(() => import("./components/RepositoryPanel").then((module) => ({ default: module.RepositoryPanel })));
const ReviewPanel = lazy(() => import("./components/ReviewPanel").then((module) => ({ default: module.ReviewPanel })));
const WritingPanel = lazy(() => import("./components/WritingPanel").then((module) => ({ default: module.WritingPanel })));
const toolLoading = <div className="tool-loading" role="status">Loading tools…</div>;
type QueueAction = "return" | "jump" | "reply" | "finish" | "reopen" | "comment" | "copy";

const lenses: Array<{ id: Lens; label: string; icon: typeof FileText }> = [
  { id: "paper", label: "Paper", icon: FileText },
  { id: "proofs", label: "Proofs", icon: ShieldCheck },
  { id: "themes", label: "Themes", icon: Sparkles },
];

function paragraphText(state: AppState, paragraphId: string, paragraphs: Paragraph[]) {
  return (
    state.paragraphEdits[paragraphId] ??
    paragraphs.find((paragraph) => paragraph.id === paragraphId)?.text ??
    ""
  );
}

export default function App() {
  const [chromePreferences, setChromePreferences] = useState(() => {
    try { return loadChromePreferences(sessionStorage.getItem(chromePreferencesKey) ? sessionStorage : localStorage); } catch { return loadChromePreferences(); }
  });
  const [editorTextZoom, setEditorTextZoom] = useStoredPaneZoom("editor");
  useEffect(() => { try { saveChromePreferences(chromePreferences, sessionStorage); saveChromePreferences(chromePreferences, localStorage); } catch { /* Appearance remains usable without browser storage. */ } }, [chromePreferences]);
  useLayoutEffect(() => { window.document.documentElement.dataset.theme = chromePreferences.theme; }, [chromePreferences.theme]);
  const [state, setState] = useState<AppState>(() => loadState());
  const latestState = useRef(state);
  latestState.current = state;
  const [document, setDocument] = useState<ProjectDocument>();
  const [queueView, setQueueView] = useState(() => {
    try { const loaded = loadQueueView(sessionStorage.getItem(queueViewKey) ? sessionStorage : localStorage); return loaded.scope === "all" ? touchQueueView(loaded) : loaded; }
    catch { return loadQueueView(); }
  });
  useEffect(() => { try { const saved = JSON.stringify(queueView); sessionStorage.setItem(queueViewKey, saved); localStorage.setItem(queueViewKey, saved); } catch { /* Queue navigation remains usable without preference storage. */ } }, [queueView]);
  const projectQueue = useProjectQueue(document?.project.id, queueView.scope === "all");
  const [queueCursor, setQueueCursor] = useState<string>();
  const [queueNavigating, setQueueNavigating] = useState(false);
  const queueNavigationBusy = useRef(false);
  const [pendingQueueAction, setPendingQueueAction] = useState<{ projectId: string; taskId: string; action: QueueAction; resolved?: boolean }>();
  const [pendingCommentJump, setPendingCommentJump] = useState<{ projectId: string; rootFile: string; taskId: string }>();
  useWindowWorkspace(document, state, setState);
  useEffect(() => {
    window.document.title = document ? `${state.destination === "notebook" ? "Notebook" : state.previewMode === "full" ? "Preview" : "Paper"} — ${document.project.name} — ${appName}` : appName;
  }, [document?.project.name, state.destination, state.previewMode]);
  const [windowFallbackUrl, setWindowFallbackUrl] = useState<string>();
  const [windowRecoveries, setWindowRecoveries] = useState<ReturnType<typeof listWindowRecoveries>>([]);
  const [trustedExperimentProject, setTrustedExperimentProject] = useState<string>();
  useEffect(() => { setTrustedExperimentProject(undefined); }, [document?.project.id]);
  const latestDocument = useRef(document); latestDocument.current = document;
  const saveInFlight = useRef<Promise<ProjectDocument> | undefined>(undefined);
  const environmentChanging = useRef(false);
  const paragraphJoinBusy = useRef(false);
  const paragraphJoinUndo = useRef<ParagraphJoinUndo | undefined>(undefined);
  const environmentCaret = useRef<{ paragraphId: string; offset: number } | undefined>(undefined);
  const [environmentBusy, setEnvironmentBusy] = useState(false);
  const environmentReturn = useRef<{ caret: SavedCaret; revision: string } | undefined>(undefined);
  useLayoutEffect(() => {
    const pending = environmentReturn.current;
    if (environmentBusy || !pending) return;
    environmentReturn.current = undefined;
    if (latestDocument.current?.revision !== pending.revision || latestState.current.destination !== "manuscript") return;
    const active = window.document.activeElement;
    if (active !== window.document.body && active?.getAttribute("data-paragraph-id") !== pending.caret.paragraphId && !active?.closest(".chunk-controls")) return;
    const target = window.document.querySelector<HTMLElement>(`.manuscript-page p[data-paragraph-id="${CSS.escape(pending.caret.paragraphId)}"]`);
    if (target?.isContentEditable) { target.focus({ preventScroll: true }); restoreEditableCaret(target, pending.caret.offset); }
  }, [environmentBusy, document?.revision]);
  const pendingSavedCaret = useRef<{ caret: SavedCaret; element: HTMLElement; revision: string; allowedIds: string[]; preserveEmptyTail?: boolean } | undefined>(undefined);
  const [autoSaveError, setAutoSaveError] = useState<string>();
  const [saveNoticeCollapsed, setSaveNoticeCollapsed] = useState(false);
  useEffect(() => { setSaveNoticeCollapsed(false); }, [autoSaveError, document?.project.id]);
  useLayoutEffect(() => {
    const pending = pendingSavedCaret.current;
    if (!pending || pending.revision !== document?.revision) return;
    pendingSavedCaret.current = undefined;
    // Run after paragraph normalization. Never reclaim focus from another tool.
    queueMicrotask(() => {
      const active = window.document.activeElement;
      const activeId = active?.getAttribute("data-paragraph-id");
      if (active !== pending.element && !(!pending.element.isConnected && active === window.document.body) && !(activeId && pending.allowedIds.includes(activeId))) return;
      if (latestDocument.current?.revision !== pending.revision || latestState.current.destination !== "manuscript") return;
      const target = window.document.querySelector<HTMLElement>(`.manuscript-page p[data-paragraph-id="${CSS.escape(pending.caret.paragraphId)}"]`);
      if (!target?.isContentEditable) return;
      const text = latestState.current.paragraphEdits[pending.caret.paragraphId] ?? latestDocument.current.paragraphs.find(p => p.id === pending.caret.paragraphId)?.text;
      if (text === undefined) return;
      const live = editableText(target);
      const keepBlank = pending.preserveEmptyTail && target === pending.element && live.trimEnd() === text.trimEnd() && hasTrailingLineBreak(live);
      if (!keepBlank && live !== text) target.replaceChildren(window.document.createTextNode(text));
      target.focus({ preventScroll: true }); restoreEditableCaret(target, keepBlank ? live.length : pending.caret.offset);
      const bounds = target.getBoundingClientRect(), viewport = target.closest(".manuscript-scroll")?.getBoundingClientRect();
      if (viewport && (bounds.bottom > viewport.bottom || bounds.top < viewport.top)) target.scrollIntoView({ block: "nearest" });
    });
  }, [document?.revision]);
  const phaseOpening = useRef<{ projectId: string; entryId?: string; recovery?: boolean; showNotebook?: boolean } | undefined>(undefined);
  const notebookStorage = useNotebookPersistence(document?.project.id, state, setState, store => {
    const opening = phaseOpening.current;
    if (!opening || opening.projectId !== document?.project.id) return;
    phaseOpening.current = undefined;
    setState(current => openResearchPhase(current, store.entries, opening.projectId, opening));
  });
  const workbenchStorage = useWorkbenchPersistence(document?.project.id, state, setState);
  const latestQueueStorage = useRef({ projectId: document?.project.id, workbench: workbenchStorage, notebook: notebookStorage });
  latestQueueStorage.current = { projectId: document?.project.id, workbench: workbenchStorage, notebook: notebookStorage };
  useQueueActivity(document?.project.id, workbenchStorage.ready && notebookStorage.ready, setState);
  useHandoffReplies(workbenchStorage.ready ? document?.project.id : undefined, state, setState);
  useReviewPackets(workbenchStorage.ready ? document?.project.id : undefined, state, setState);
  const [replyTaskId, setReplyTaskId] = useState<string>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewTaskId, setReviewTaskId] = useState<string>();
  const [reviewBlockId, setReviewBlockId] = useState<string>();
  const [writingOpen, setWritingOpen] = useState(false);
  const [writingTaskId, setWritingTaskId] = useState<string>();
  useEffect(() => { setWritingOpen(false); setWritingTaskId(undefined); }, [document?.project.id]);
  useEffect(() => { if (document) setState(current => reconcileWritingReviews(current, document)); }, [document, state.paragraphEdits]);
  useEffect(() => { setReviewOpen(false); setReviewTaskId(undefined); setReviewEditing(false); }, [document?.project.id]);
  const [readyReturns, setReadyReturns] = useState<string[]>([]);
  const previousTasks = useRef<{ projectId?: string; tasks: AttentionTask[] }>({ tasks: [] });
  const latestProjectId = useRef(document?.project.id);
  latestProjectId.current = document?.project.id;
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [manuscriptBusy, setManuscriptBusy] = useState(false);
  const manuscriptNavigationBusy = useRef(false);
  const [linkedSourceOpened, setLinkedSourceOpened] = useState(false);
  const [linkedSourceNoticeDismissed, setLinkedSourceNoticeDismissed] = useState(false);
  const linkedSourceAutoAttempt = useRef(false);
  const [sectionUndo, setSectionUndo] = useState<{ projectId: string; mainFile: string; revision: string; operationId: string } | undefined>(() => {
    try { const kept = JSON.parse(sessionStorage.getItem("active-writing.section-undo.v1") ?? "null");
      if (kept && [kept.projectId, kept.mainFile, kept.revision, kept.operationId].every(value => typeof value === "string" && value.length <= 2000)) return kept;
    } catch { /* Undo journals and source recovery remain on disk. */ }
  });
  useEffect(() => { try { if (sectionUndo) sessionStorage.setItem("active-writing.section-undo.v1", JSON.stringify(sectionUndo)); else sessionStorage.removeItem("active-writing.section-undo.v1"); } catch { /* Optional immediate undo notice. */ } }, [sectionUndo]);
  const navigationArchive = useRef<{ projectId: string; key: string } | undefined>(undefined);
  const [projectError, setProjectError] = useState<string>();
  const [browserRecoveryError, setBrowserRecoveryError] = useState<string>();
  const [largerRecovery, setLargerRecovery] = useState(largerRecoveryStatus);
  useEffect(() => subscribeLargerRecovery(() => setLargerRecovery(largerRecoveryStatus())), []);
  const [recoveryRetry, setRecoveryRetry] = useState(0);
  const [savingPaper, setSavingPaper] = useState(false);
  const sourceMonitor = useSourceMonitor(document);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const plainSourceFlush=useRef<(()=>Promise<void>)|undefined>(undefined);
  const [plainFile,setPlainFile]=useState<string>();
  const [preambleEditing,setPreambleEditing]=useState(false);
  const commandFlushes = useRef(new Map<string, () => Promise<void>>());
  const commandSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const commandEditing = useMemo<SourceCommandEditing>(() => ({
    identity: `${document?.project.id}:${document?.project.mainFile}`,
    register: (key, flush) => { if (flush) commandFlushes.current.set(key, flush); else commandFlushes.current.delete(key); },
    save: saveSourceCommand,
    comment: addCommandComment,
  }), [document?.project.id, document?.project.mainFile]);
  const resumeReadyProject = useRef<string | undefined>(undefined);
  const [incomingSource, setIncomingSource] = useState<ProjectDocument>();
  const [sourceCopies, setSourceCopies] = useState<SourceDraftCopy[]>([]);
  const [sourceRefreshError, setSourceRefreshError] = useState<string>();
  const [sourceRefreshing, setSourceRefreshing] = useState(false);
  const sourceRefreshBusy = useRef(false);
  const sourcePlan = useMemo(() => document && incomingSource?.project.id === document.project.id && incomingSource.project.mainFile === document.project.mainFile
    ? sourceRefreshPlan(document, incomingSource, state.paragraphEdits, state.draftRevision) : undefined,
    [document, incomingSource, state.paragraphEdits, state.draftRevision]);
  const [savingHandoff, setSavingHandoff] = useState(false);
  const manuscriptNodes = document?.nodes ?? [];
  const paragraphs = useSourceLines(document);
  const paneSplit = usePaneSplit();
  const [scopeChanging, setScopeChanging] = useState(false);
  const [sectionMoving, setSectionMoving] = useState(false);
  const sectionMoveBusy = useRef(false);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection>();
  const [activeRewriteId, setActiveRewriteId] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [compileMenuOpen, setCompileMenuOpen] = useState(false);
  const compileControlRef = useRef<HTMLDivElement>(null);
  useDismissibleLayer(compileMenuOpen, compileControlRef, () => setCompileMenuOpen(false), ".compile-menu-button");
  const [latexMenuOpen, setLatexMenuOpen] = useState(false);
  const [previewFormat, setPreviewFormat] = useState<"pdf" | "reading">("pdf");
  const [previewControlsTarget, setPreviewControlsTarget] = useState<HTMLDivElement | null>(null);
  const latexControlRef = useRef<HTMLDivElement>(null);
  useDismissibleLayer(latexMenuOpen, latexControlRef, () => setLatexMenuOpen(false), ".latex-menu-button");
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const displayControlRef = useRef<HTMLDivElement>(null);
  useDismissibleLayer(displayMenuOpen, displayControlRef, () => setDisplayMenuOpen(false), ".display-button");
  const [toolbarControlsOpen, setToolbarControlsOpen] = useState(false);
  const editorToolbarRef = useRef<HTMLDivElement>(null);
  useDismissibleLayer(toolbarControlsOpen, editorToolbarRef, () => setToolbarControlsOpen(false), ".toolbar-reveal-button");
  const [manuscriptPromptOpen, setManuscriptPromptOpen] = useState(false);
  const [workbenchDetailsOpen, setWorkbenchDetailsOpen] = useState(false);
  useEffect(() => { setManuscriptPromptOpen(false); setWorkbenchDetailsOpen(false); setCompileMenuOpen(false); setLatexMenuOpen(false); setDisplayMenuOpen(false); }, [document?.project.id, state.destination]);
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<CompileResult>();
  const forwardSyncSequence = useRef(0);
  const [forwardSyncRequest, setForwardSyncRequest] = useState<{ identity: string; paragraphId: string; sequence: number }>();
  const manuscriptBuildCache = useRef(new ManuscriptBuildCache());
  const pendingRootCompile = useRef<string | undefined>(undefined);
  const [rootCompileReady, setRootCompileReady] = useState<string>();
  const [scopeCompileRequest, setScopeCompileRequest] = useState<string>();
  const renderedCompileScope = useRef<string>("");
  const compileInFlight = useRef(false);
  const [lastFullCompile, setLastFullCompile] = useState<CompileResult>();
  const [compileStale, setCompileStale] = useState(false);
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(false);
  const narrowWorkspace = useMediaQuery("(max-width: 820px)");
  const outlineToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!narrowWorkspace) setMobileOutlineOpen(false); }, [narrowWorkspace]);
  useEffect(() => {
    if (!mobileOutlineOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMobileOutlineOpen(false); outlineToggleRef.current?.focus(); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [mobileOutlineOpen]);
  const [activeHandoff, setActiveHandoff] = useState<"chatgpt" | "codex">();
  const [latexAssistantOpen, setLatexAssistantOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [referenceRequest, setReferenceRequest] = useState<ReferenceRequest>();
  const [jumpTarget, setJumpTarget] = useState<SourceJumpTarget>();
  const sourcePositionReader = useRef<(() => SourceViewportPosition | undefined) | undefined>(undefined);
  const manuscriptReturnPositions = useRef(new Map<string, SourceViewportPosition & {file?: string; paragraphText: string; revision: string}>());
  const saveWorkspaceView = useStableEvent(() => {
    const paper = latestDocument.current;
    if (!paper || resumeReadyProject.current !== paper.project.id) return;
    try {
      const cache = windowStateCache(), key = resumeKey(paper.project.id, paper.project.mainFile);
      const old = parseWorkspaceResume(cache.read(key) ?? cache.read(resumeKey(paper.project.id)));
      const view = sourcePositionReader.current?.(), paragraph = paper.paragraphs.find(p => p.id === view?.paragraphId);
      const sourcePosition = paragraph && view ? { ...view, file: paragraph.file, paragraphText: latestState.current.paragraphEdits[paragraph.id] ?? paragraph.text, revision: paper.revision }
        : old?.rootFile === paper.project.mainFile ? old.sourcePosition : undefined;
      const value = JSON.stringify({ version: 1, rootFile: paper.project.mainFile, previewFormat, rawEditor: preambleEditing, sourceFile: plainFile, sourcePosition, manuscriptView: manuscriptView(latestState.current) });
      cache.writeSnapshot(key, value, value);
      cache.writeSnapshot(resumeKey(paper.project.id), value, value);
    } catch { /* Source/notebook draft caching reports its own storage failures. */ }
  });
  useEffect(() => { if (document) saveWorkspaceView(); }, [document?.project.id, document?.project.mainFile, state.activeNodeId, state.activeParagraphId, state.focusedNodeId, state.hiddenNodeIds, state.collapsedNodeIds, state.progressByNode, previewFormat, preambleEditing, plainFile, saveWorkspaceView]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scrolled = (event: Event) => { if (!(event.target instanceof Element) || !event.target.matches(".manuscript-scroll")) return; clearTimeout(timer); timer = setTimeout(saveWorkspaceView, 300); };
    const rememberActive = () => { const paper = latestDocument.current; if (paper) rememberProject(sessionStorage, localStorage, paper.project.id); };
    const rememberView = () => { rememberActive(); saveWorkspaceView(); };
    const checkpoint = () => {
      clearTimeout(timer); saveWorkspaceView();
      const paper = latestDocument.current; if (!paper) return;
      try {
        const current = latestState.current, edits = { ...current.paragraphEdits };
        for (const element of window.document.querySelectorAll<HTMLElement>('p[data-paragraph-id][contenteditable="true"]')) {
          const p = paper.paragraphs.find(p => p.id === element.dataset.paragraphId); if (!p) continue;
          const text = editableText(element), base = current.paragraphEdits[p.id] ?? p.text;
          if (element.dataset.savedEmptyTail && text.trimEnd() === base.trimEnd()) continue;
          if (text !== base) edits[p.id] = text;
        }
        saveState({ ...current, paragraphEdits: edits, draftRevision: Object.keys(edits).length ? current.draftRevision ?? paper.revision : undefined,
          draftMainFile: Object.keys(edits).length ? current.draftMainFile ?? paper.project.mainFile : undefined }, paper.project.id);
      } catch { /* Keep earlier complete checkpoints; never send a blind unload save. */ }
    };
    const hide = () => { checkpoint(); try { windowStateCache().release(); } catch { /* lease also expires */ } };
    const visibility = () => { if (window.document.visibilityState === "hidden") checkpoint(); };
    window.document.addEventListener("scroll", scrolled, true); window.document.addEventListener("pointerdown", rememberView, true); window.document.addEventListener("keydown", rememberActive, true);
    window.addEventListener("focus", rememberView); window.addEventListener("pagehide", hide); window.document.addEventListener("visibilitychange", visibility);
    return () => { clearTimeout(timer); window.document.removeEventListener("scroll", scrolled, true); window.document.removeEventListener("pointerdown", rememberView, true); window.document.removeEventListener("keydown", rememberActive, true); window.removeEventListener("focus", rememberView); window.removeEventListener("pagehide", hide); window.document.removeEventListener("visibilitychange", visibility); };
  }, [saveWorkspaceView]);
  const [previewJumpTarget, setPreviewJumpTarget] = useState<import("./types").PreviewLocation>();
  const sourceSyncSequence = useRef(0);
  useEffect(() => { sourceSyncSequence.current++; setPreviewJumpTarget(undefined); }, [document?.project.id]);
  const [navigationHistory, setNavigationHistory] = useState<Array<Pick<AppState, "lens" | "activeNodeId" | "focusedNodeId" | "hiddenNodeIds" | "previewMode" | "blockWindow"> & { returnParagraphId?: string; turboCursor?: string }>>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarPointerNavigation = useRef(false);
  const chromePointerNavigation = useRef(false);
  const [chromeRevealed, setChromeRevealed] = useState(false);
  const [sidebarRevealed, setSidebarRevealed] = useState(false);
  const chromeHover=useRef<ReturnType<typeof createHoverIntent> | undefined>(undefined);
  const sidebarHover=useRef<ReturnType<typeof createHoverIntent> | undefined>(undefined);
  if(!chromeHover.current)chromeHover.current=createHoverIntent(()=>setChromeRevealed(true));
  if(!sidebarHover.current)sidebarHover.current=createHoverIntent(()=>setSidebarRevealed(true));
  const chromeHideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(chromeHideTimer.current);chromeHover.current?.cancel();sidebarHover.current?.cancel(); }, []);
  function delayChromeReveal(){clearTimeout(chromeHideTimer.current);if(!chromeRevealed)chromeHover.current?.enter();}
  function delayChromeHide(frame: HTMLElement) {
    chromeHover.current?.cancel();
    const focused = window.document.activeElement;
    if (chromePointerNavigation.current && focused instanceof HTMLButtonElement && frame.contains(focused) && !frame.querySelector("details[open], .workspace-folders-panel")) focused.blur();
    // Allow crossing the neutral gap or clicking the toolbar before collapsing.
    clearTimeout(chromeHideTimer.current); chromeHideTimer.current = setTimeout(() => setChromeRevealed(false), 280);
  }
  useEffect(() => { setState(current => rememberDeferredTasks(current, undefined, manuscriptPromptOpen ? current.manuscriptPromptId : undefined)); }, [state.activeNodeId, state.activeParagraphId, state.destination, state.activeNotebookId, state.attentionTasks, manuscriptPromptOpen]);

  useEffect(() => {
    setBrowserRecoveryError(document ? saveBrowserRecovery(() => saveState({ ...state,
      draftMainFile: Object.keys(state.paragraphEdits).length ? state.draftMainFile ?? document.project.mainFile : undefined }, document.project.id)) : undefined);
  }, [state, document, recoveryRetry]);
  useEffect(() => {
    if (!document || !Object.keys(state.paragraphEdits).length || savingPaper || autoSaveError || repositoryOpen || sourceRefreshing || incomingSource && (sourcePlan?.conflicts.length || sourcePanelOpen && incomingSource.revision !== document.revision)) return;
    const timer = window.setTimeout(() => { void savePaper().catch((error) => setAutoSaveError(error.message)); }, 1100);
    return () => window.clearTimeout(timer);
  }, [document, state.paragraphEdits, savingPaper, autoSaveError, repositoryOpen, sourcePanelOpen, sourceRefreshing, sourceMonitor.changed, incomingSource, sourcePlan]);
  useEffect(() => {
    let cancelled = false;
    let projectId = initialWindowRequest?.projectId;
    try { projectId = startupProject(sessionStorage, localStorage, initialWindowRequest); } catch { /* URL/default project remains available. */ }
    void loadDocument(`/api/paperfocus/document${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`)
      .then((result) => { if (!cancelled) {
        const linked = initialWindowRequest?.projectId === result.project.id ? initialWindowRequest : undefined;
        phaseOpening.current = { projectId: result.project.id, entryId: linked?.panel === "notebook" ? linked.notebookId : undefined, recovery: Boolean(linked?.recoveryId), showNotebook: Boolean(linked?.panel === "notebook" && !hasSavedWindowState(result.project.id)) };
        activateDocument(result);
      } })
      .catch((error) => { if (!cancelled) setProjectError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);
  const searchShortcut = useStableEvent((event: KeyboardEvent) => {
    if (state.destination !== "manuscript" || !(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "k") return;
    event.preventDefault();
    setState((current) => ({ ...current, outlineCollapsed: false }));
    if (window.matchMedia("(max-width: 820px)").matches) setMobileOutlineOpen(true);
    // Reveal the simplified contents panel before focusing its search field.
    window.requestAnimationFrame(() => searchRef.current?.focus());
  });
  useEffect(() => {
    window.addEventListener("keydown", searchShortcut);
    return () => window.removeEventListener("keydown", searchShortcut);
  }, [searchShortcut]);
  useEffect(() => {
    let cancelled = false;
    if (!document) return;
    const identity = manuscriptBuildIdentity(document);
    const cached = manuscriptBuildCache.current.read(document);
    setCompileResult(cached); setLastFullCompile(undefined); setRootCompileReady(undefined);
    void fetch(`/api/paperfocus/status?projectId=${document.project.id}`)
      .then(async (response) => {
        if (response.status === 204) return undefined;
        if (!response.ok) throw new Error("Compile status is unavailable.");
        return (await response.json()) as CompileStatus;
      })
      .then((result) => {
        if (cancelled || !result) return;
        // Never restore the project's last PDF into another manuscript.
        if (result.mainFile !== document.project.mainFile || result.engine !== document.project.engine) return;
        if (cached && !matchingManuscriptBuild(result, document)) return;
        setCompileResult(result);
        manuscriptBuildCache.current.remember(document, result);
        if (result.fullVerified && result.fullCompile) setLastFullCompile(result.fullCompile);
        else if (result.mode === "full" && result.success && !result.stale) setLastFullCompile(result);
        setCompileStale(Boolean(result.stale || !result.fullVerified));
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setRootCompileReady(identity); });
    return () => {
      cancelled = true;
    };
  }, [document?.project.id, document?.project.mainFile, document?.project.engine, documentEpoch]);
  // A detached PDF follows completed builds, not typing/scrolling. It never requests a compile.
  const receiveWindowBuild = useStableEvent(async () => {
    const before = latestDocument.current;
    if (!before || initialWindowRequest?.panel !== "preview" || previewFormat !== "pdf" || latestState.current.previewMode !== "full" || latestState.current.destination !== "manuscript") return;
    try {
      const response = await fetch(`/api/paperfocus/status?projectId=${encodeURIComponent(before.project.id)}`);
      if (!response.ok || response.status === 204) return;
      const result = await response.json() as CompileStatus;
      const current = latestDocument.current;
      if (!current || current.project.id !== before.project.id || current.project.mainFile !== before.project.mainFile || current.project.engine !== before.project.engine
        || result.mainFile !== current.project.mainFile || result.engine !== current.project.engine || !result.success) return;
      setCompileResult(result); setCompileStale(Boolean(result.stale || Object.keys(latestState.current.paragraphEdits).length));
      if (result.fullVerified && result.fullCompile) setLastFullCompile(result.fullCompile);
    } catch { /* Keep the last displayed PDF when build checking fails. */ }
  });
  useEffect(() => subscribeWindowMessages(message => { if (message.kind === "compile" && message.projectId === latestDocument.current?.project.id) void receiveWindowBuild(); }), [receiveWindowBuild]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pendingLocalKey = state.attentionTasks.filter((task) => task.localJobId && ["queued", "working"].includes(task.status)).map((task) => task.localJobId).sort().join(",");
  useEffect(() => {
    if (!document || !pendingLocalKey || !workbenchStorage.ready) return;
    let cancelled = false;
    let polling = false;
    const projectId = document.project.id;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const jobs = await Promise.all(pendingLocalKey.split(",").map(async (id) => {
          const response = await fetch(`/api/paperfocus/local-rewrite/job?projectId=${projectId}&id=${id}`);
          const result = await response.json();
          return response.ok ? result : { id, status: "failed", error: result.error ?? "Reply unavailable. Your request is kept." };
        }));
        if (cancelled || latestProjectId.current !== projectId) return;
        const completed = jobs.filter((job) => ["ready", "failed"].includes(job.status));
        if (!completed.length) return;
        setState((current) => {
          const now = new Date().toISOString();
          const tasks = current.attentionTasks.map((task) => {
            const job = completed.find((item) => item.id === task.localJobId);
            return job && ["queued", "working"].includes(task.status) ? { ...task, status: job.status as AttentionTask["status"], error: job.error, updatedAt: now } : task;
          });
          return { ...current, attentionTasks: tasks, notebookEntries: current.notebookEntries.map((entry) => {
            if (!entry.study) return entry;
            let changed = false;
            const turns = entry.study.turns.map((turn) => {
              const task = tasks.find((item) => item.notebookId === entry.id && item.studyTurnId === turn.id && item.status !== "reviewed");
              const job = completed.find((item) => item.id === task?.localJobId);
              if (!job || turn.status !== "queued" || turn.reply.trim() || turn.closed) return turn;
              changed = true;
              return job.status === "ready" ? { ...turn, status: "ready" as const, reply: job.studyReply ?? "", answer: job.studyAnswer, secondLook: job.secondLook, error: undefined }
                : { ...turn, status: "failed" as const, partialReply: job.studyReply || turn.partialReply, error: job.error };
            });
            return changed ? { ...entry, study: { ...entry.study, turns }, updatedAt: now } : entry;
          }), rewriteSessions: current.rewriteSessions.map((session) => {
            const task = tasks.find((item) => item.sessionId === session.id && item.localJobId && item.status === "ready");
            const job = completed.find((item) => item.id === task?.localJobId && item.status === "ready");
            if (!job) return session;
            const candidates: RewriteCandidate[] = (job.candidates ?? []).map((text: string, index: number) => ({ id: `local-${job.id}-${index}`, text, source: `Local · ${job.model}${job.cached ? " · cached" : ""}`, dismissed: false, userEdited: false }));
            const added = candidates.filter((candidate) => !session.candidates.some((existing) => existing.id === candidate.id));
            return { ...session, candidates: [...session.candidates, ...added], selectedCandidateId: session.selectedCandidateId ?? added[0]?.id, updatedAt: now };
          }) };
        });
      } catch { /* A transient disconnect can recover on the next bounded poll. */ }
      finally { polling = false; }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [document?.project.id, pendingLocalKey, workbenchStorage.ready]);

  const activeRewrite = useMemo(
    () => state.rewriteSessions.find((session) => session.id === activeRewriteId),
    [activeRewriteId, state.rewriteSessions],
  );
  const activeNode =
    manuscriptNodes.find((node) => node.id === state.activeNodeId) ?? manuscriptNodes[0] ?? { id: "document", title: "Document", kind: "section" as const, depth: 0, paragraphIds: [] };
  const activeTheme =
    state.themeLenses.find((theme) => theme.id === state.activeThemeId) ??
    state.themeLenses[0];
  const handoffParagraphId = state.turbo.enabled ? state.turbo.activeParagraphId : paragraphs.find((paragraph) => paragraph.id === state.activeParagraphId && paragraph.nodeId === activeNode.id)?.id ?? activeNode.paragraphIds[0];
  const openTasks = attentionQueue(state.attentionTasks);
  const blockComments = useMemo(() => document ? blockReviewComments(state.attentionTasks, document, state.paragraphEdits) : {}, [document, state.attentionTasks, state.paragraphEdits]);
  const blockCommentCounts = useMemo(() => Object.fromEntries(Object.entries(blockComments).map(([id, comments]) => [id, comments.length])), [blockComments]);
  const manuscriptWritingMarkers = useMemo(() => document ? writingMarkers(state.attentionTasks, document, state.paragraphEdits) : {}, [document, state.attentionTasks, state.paragraphEdits]);
  const openWritingReview = useStableEvent((id: string) => { const task = latestState.current.attentionTasks.find(t => t.id === id && t.writing); if (task) returnToTask(task); });
  const queueTasks = useMemo(() => scopedProjectQueue(document?.project, state.attentionTasks, projectQueue.tasks, queueView, task => attentionTaskLocation(task, document)), [document, state.attentionTasks, projectQueue.tasks, queueView]);
  const waitingChats = waitingPasteHandoffs(state.attentionTasks, state.hiddenWaitingNoticeIds);
  const receivedTasks = readyReturns.map((id) => state.attentionTasks.find((task) => task.id === id && task.status === "ready" && !task.queueHiddenAt)).filter((task): task is AttentionTask => Boolean(task));
  const pass = useMemo(() => turboPass(paragraphs, manuscriptNodes, state.hiddenNodeIds, state.turbo.includeTechnical), [document, state.hiddenNodeIds, state.turbo.includeTechnical]);
  const turboParagraph = pass.find((paragraph) => paragraph.id === state.turbo.activeParagraphId) ?? pass[0];
  const { source: turboWindow, preview: turboPreview } = turboWindows(pass, turboParagraph?.id, state.turbo.context);
  const turboPreviewIds = useMemo(() => turboPreview.paragraphs.map(p => p.id), [pass, turboParagraph?.id, state.turbo.context]);
  const blockWindow = useMemo(() => state.blockWindow && !state.turbo.enabled && state.lens !== "themes"
    ? manuscriptBlockWindow(manuscriptNodes, paragraphs, state.lens, state.hiddenNodeIds, state.blockWindow, state.activeParagraphId, state.activeNodeId) : undefined,
    [manuscriptNodes, paragraphs, state.blockWindow, state.turbo.enabled, state.lens, state.hiddenNodeIds, state.activeParagraphId, state.activeNodeId]);
  const blockWindowIds = useMemo(() => blockWindow?.paragraphs.map(p => p.id), [blockWindow]);
  const turboChecked = useMemo(() => state.turbo.enabled ? pass.filter((paragraph) => reviewed(state.turbo, paragraph.id, state.paragraphEdits[paragraph.id] ?? paragraph.text)).length : 0, [pass, state.turbo, state.paragraphEdits]);
  const replyTask = state.attentionTasks.find((task) => task.id === replyTaskId);
  const replySource = useMemo(() => replyTask && document ? checkTaskSource(replyTask.sourceSnapshot, document, state.paragraphEdits) : undefined, [replyTask?.id, replyTask?.sourceSnapshot, document, state.paragraphEdits]);
  const inspectorOpen = Boolean(writingOpen || reviewOpen || activeRewrite || activeHandoff || latexAssistantOpen || referenceRequest || replyTask);
  useEffect(() => {
    if (activeRewrite || activeHandoff || latexAssistantOpen || referenceRequest || replyTask || state.destination === "notebook") setReviewOpen(false);
    if (reviewOpen || activeRewrite || activeHandoff || latexAssistantOpen || referenceRequest || replyTask || state.destination === "notebook") setWritingOpen(false);
  }, [reviewOpen, activeRewrite, activeHandoff, latexAssistantOpen, referenceRequest, replyTask, state.destination]);
  const effectivePreviewMode = inspectorOpen || state.destination === "notebook" ? "hidden" : state.previewMode;
  const turboBlocked = inspectorOpen || compiling || savingHandoff || repositoryOpen || state.destination === "notebook";
  const sectionNavigation = document && state.destination === "manuscript" && state.lens === "paper" && !preambleEditing && !state.blockWindow && !state.turbo.enabled && state.focusedNodeId ? {
    key: `${document.project.id}:${document.project.mainFile}:${state.focusedNodeId}`,
    previous: adjacentManuscriptSection(manuscriptNodes, state.focusedNodeId, state.hiddenNodeIds, -1)?.title,
    next: adjacentManuscriptSection(manuscriptNodes, state.focusedNodeId, state.hiddenNodeIds, 1)?.title,
    blocked: sectionMoving || turboBlocked || manuscriptBusy || environmentBusy || Boolean(pendingSelection), onMove: moveSection,
  } : undefined;
  const compileWindowIds = useMemo(() => state.turbo.enabled ? turboPreviewIds : blockWindow?.paragraphs.filter(p => !p.emptySource).map(p => p.id), [blockWindow, state.turbo.enabled, turboPreviewIds]);
  const compileFocus = state.turbo.enabled || blockWindow ? undefined : state.focusedNodeId;
  const compileScope = manuscriptBuildScope({ focusNodeId: compileFocus, lens: state.lens, hiddenNodeIds: state.hiddenNodeIds, paragraphIds: compileWindowIds });
  renderedCompileScope.current = compileScope;
  const compiledScope = compileResult?.scope && manuscriptBuildScope(compileResult.scope);
  const sourceEdits = useMemo(() => JSON.stringify(state.paragraphEdits), [state.paragraphEdits]);
  useEffect(() => {
    if (!forwardSyncRequest || !document) return;
    if (forwardSyncRequest.identity !== manuscriptBuildIdentity(document)) { setForwardSyncRequest(undefined); return; }
    if (compiling || compileInFlight.current || manuscriptBusy || savingPaper || sourceRefreshing || incomingSource || autoSaveError || effectivePreviewMode === "hidden") return;
    // One guarded build attempt per explicit jump. Requests wait for an ongoing
    // build; failures do not cause a compile/retry loop.
    setForwardSyncRequest(undefined);
    const { identity, paragraphId, sequence } = forwardSyncRequest;
    if (previewFormat !== "pdf") { setPreviewJumpTarget({ paragraphId, sequence: ++sourceSyncSequence.current }); return; }
    const show = (build?: CompileResult) => {
      if (build?.success && sequence === forwardSyncSequence.current && latestDocument.current && manuscriptBuildIdentity(latestDocument.current) === identity) void syncPdf("forward", { paragraphId }, build);
    };
    // Save command drafts as well as paragraph drafts before any cache lookup.
    void compileLatex("focus", false, true).then(show);
  }, [forwardSyncRequest, document, previewFormat, effectivePreviewMode, compiling, manuscriptBusy, savingPaper, sourceRefreshing, incomingSource, autoSaveError, compileResult, compileScope, compiledScope, sourceEdits]);
  useEffect(() => {
    if (!document || pendingRootCompile.current !== rootCompileReady || rootCompileReady !== manuscriptBuildIdentity(document)
      || previewFormat !== "pdf" || effectivePreviewMode === "hidden" || compiling || manuscriptBusy || savingPaper
      || sourceRefreshing || incomingSource || autoSaveError || pendingSelection || state.turbo.enabled) return;
    pendingRootCompile.current = undefined; // One attempt per opening; errors never create a retry loop.
    if (matchingManuscriptBuild(compileResult, document) && (compileResult?.mode === "full" ? compileScope === manuscriptBuildScope({}) : compiledScope === compileScope)) return;
    void compileLatex("focus", false, true);
  }, [document?.project.id, document?.project.mainFile, rootCompileReady, previewFormat, effectivePreviewMode, compiling,
    manuscriptBusy, savingPaper, sourceRefreshing, incomingSource, autoSaveError, pendingSelection, state.turbo.enabled, compileResult, compileScope]);
  useEffect(() => {
    if (!scopeCompileRequest || !document) return;
    if (scopeCompileRequest !== manuscriptBuildIdentity(document)) { setScopeCompileRequest(undefined); return; }
    if (rootCompileReady !== scopeCompileRequest || previewFormat !== "pdf" || effectivePreviewMode === "hidden" || compiling || compileInFlight.current
      || manuscriptBusy || savingPaper || sourceRefreshing || incomingSource || autoSaveError || pendingSelection || state.turbo.enabled) return;
    // Explicit scope changes are not typing-idle compilation. Consume once,
    // after navigation/save guards, and let the latest view win a running build.
    setScopeCompileRequest(undefined);
    void compileLatex("focus", false, true);
  }, [scopeCompileRequest, rootCompileReady, document, previewFormat, effectivePreviewMode, compiling, manuscriptBusy, savingPaper,
    sourceRefreshing, incomingSource, autoSaveError, pendingSelection, state.turbo.enabled, compileScope, compileResult, sourceEdits]);
  useIdleCompilation({ enabled: !state.turbo.enabled && chromePreferences.automaticCompilation && previewFormat === "pdf" && effectivePreviewMode !== "hidden",
    projectId: document?.project.id, key: JSON.stringify([document?.revision, document?.project.mainFile, document?.project.engine, compileScope, sourceEdits]),
    viewKey: JSON.stringify([document?.project.mainFile, document?.project.engine, compileScope]),
    needsCompile: !compileResult?.success || Boolean(compileResult.stale) || Boolean(Object.keys(state.paragraphEdits).length) || compileResult.sourceRevision !== document?.revision || compileResult.mode !== "full" && compiledScope !== compileScope,
    blocked: turboBlocked || savingPaper || savingHandoff || sourceRefreshing || compileMenuOpen || latexMenuOpen || Boolean(autoSaveError || incomingSource || pendingSelection || manuscriptPromptOpen),
    blockWindow: Boolean(blockWindow),
  }, async () => { await compileLatex("focus", false, true); });
  const workSuggestion = useMemo(() => document ? suggestWork(document, state) : undefined,
    [document, state.destination, state.activeNotebookId, state.activeNodeId, state.activeParagraphId, state.notebookEntries, state.suggestions.relation, state.attentionTasks, state.paragraphEdits, state.progressByNode, state.hiddenNodeIds, state.turbo, state.lens]);
  const manuscriptNotebookEntries=useMemo(()=>document ? notebookForManuscript(state.notebookEntries,document.project.mainFile) : state.notebookEntries,[state.notebookEntries,document?.project.mainFile]);
  const catalogueEntries=useMemo(()=>orderedNotebookEntries(manuscriptNotebookEntries).filter(entry=>!entry.filed),[manuscriptNotebookEntries]);
  const activeNotebook = state.notebookEntries.find((entry) => entry.id === state.activeNotebookId) ?? catalogueEntries[0];
  const isPassageQueued = useMemo(() => document ? (selection: Parameters<typeof passageBookmark>[3]) => !!passageBookmark(state.attentionTasks, document, state.paragraphEdits, selection) : undefined, [document, state.attentionTasks, state.paragraphEdits]);
  const activeCommentHighlight = useMemo(() => {
    if (!reviewOpen || !document || state.destination !== "manuscript") return undefined;
    const task = state.attentionTasks.find(task => task.id === reviewTaskId);
    return task ? reviewCommentTarget(task, document, state.paragraphEdits) : undefined;
  }, [reviewOpen, reviewTaskId, document, state.destination, state.attentionTasks, state.paragraphEdits]);
  const currentQueueTask = openTasks.find(task => task.id === replyTaskId || writingOpen && task.id === writingTaskId || reviewOpen && task.id === reviewTaskId)
    ?? (manuscriptPromptOpen ? openTasks.find(task => task.notebookId === state.manuscriptPromptId && task.studyTurnId === state.notebookEntries.find(entry => entry.id === state.manuscriptPromptId)?.study?.activeTurnId) : undefined)
    ?? (state.destination === "manuscript" && document ? openTasks.find(task => projectQueueId(document.project.id, task.id) === queueCursor && notebookQueuePassage(task, document, state)?.id === handoffParagraphId) : undefined)
    ?? openTasks.find(task => state.destination === "notebook" ? task.notebookId === activeNotebook?.id && (!task.studyTurnId || task.studyTurnId === (activeNotebook?.study?.activeTurnId ?? activeNotebook?.study?.turns.at(-1)?.id)) : !task.notebookId && task.nodeId === activeNode.id && task.paragraphId === handoffParagraphId)
    ?? (state.destination === "manuscript" && document ? openTasks.find(task => task.reminder?.kind === "section" && sectionReminderTarget(task, document)?.nodeId === activeNode.id) : undefined);
  const currentCheckParagraph = state.destination === "manuscript" ? paragraphs.find(p => p.id === handoffParagraphId) : undefined;
  const manuscriptPrompt = state.notebookEntries.find((entry) => entry.id === state.manuscriptPromptId);
  const activeNotebookPassage = document && locateSavedPassage(activeNotebook?.source, document, state.paragraphEdits);
  const linkedNotebookEntries = useMemo(() => document && state.destination === "manuscript"
    ? notebookEntriesForPassage(state.notebookEntries, document, state.paragraphEdits, handoffParagraphId) : [],
    [document, state.destination, state.notebookEntries, state.paragraphEdits, handoffParagraphId]);
  const readyNotebookEntries = useMemo(() => {
    const pending = new Set(state.attentionTasks.filter(task => task.status === "ready" && !task.queueHiddenAt).map(task => task.notebookId));
    return manuscriptNotebookEntries.filter(entry => !entry.recoveryKey && pending.has(entry.id) && notebookReplyStatus(entry) === "answer");
  }, [state.attentionTasks, manuscriptNotebookEntries]);
  useEffect(() => {
    if (state.turbo.enabled && turboParagraph && (state.turbo.activeParagraphId !== turboParagraph.id || state.activeNodeId !== turboParagraph.nodeId || state.activeParagraphId !== turboParagraph.id)) {
      setState((current) => ({ ...current, activeNodeId: turboParagraph.nodeId, activeParagraphId: turboParagraph.id, turbo: { ...current.turbo, activeParagraphId: turboParagraph.id, atEnd: false } }));
    }
  }, [state.turbo.enabled, turboParagraph?.id, state.activeNodeId, state.activeParagraphId]);
  const displayMode =
    displayModes.find((mode) => mode.id === state.displayMode) ?? displayModes[0];
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (query.length < 2) return [];
    return paragraphs
      .filter((paragraph) =>
        (state.paragraphEdits[paragraph.id] ?? paragraph.text)
          .toLocaleLowerCase()
          .includes(query),
      )
      .slice(0, 8)
      .map((paragraph) => ({
        paragraph,
        node: manuscriptNodes.find((node) => node.id === paragraph.nodeId),
        text: state.paragraphEdits[paragraph.id] ?? paragraph.text,
      }));
  }, [searchQuery, state.paragraphEdits, document]);

  function activateDocument(incoming: ProjectDocument, preserveState = false, openManuscript = false, diskNavigationSaved = false) {
    const previous = latestDocument.current;
    let previousState = latestState.current;
    const keepOutgoing = (projectId: string) => {
      // Only a completed guarded navigation may outlive a browser quota failure.
      // Source/disk-save failures still stop before this activation is reached.
      if (diskNavigationSaved) setBrowserRecoveryError(saveBrowserRecovery(() => saveState(previousState, projectId)));
      else saveState(previousState, projectId);
    };
    const archived = navigationArchive.current;
    if (archived && archived.projectId === previous?.project.id) {
      previousState = finishNavigationDraft(previousState, archived.key);
      keepOutgoing(archived.projectId);
      navigationArchive.current = undefined;
      setToast("Paper opened. An unfinished draft was kept in Paper & files → Source changes & drafts; no source was overwritten.");
    } else if (previous) keepOutgoing(previous.project.id);
    if (previous) saveWorkspaceView();
    let loaded = preserveState ? previousState : loadState(incoming.project.id);
    let resume;
    try {
      const cache = windowStateCache(), fresh = Boolean(initialWindowRequest) && !hasSavedWindowState(incoming.project.id);
      resume = parseWorkspaceResume(cache.read(resumeKey(incoming.project.id, incoming.project.mainFile), fresh) ?? cache.read(resumeKey(incoming.project.id), fresh));
    } catch { /* Optional view recovery. */ }
    if (resume?.rootFile !== incoming.project.mainFile) resume = undefined;
    const rootChanged = previous?.project.id === incoming.project.id && previous.project.mainFile !== incoming.project.mainFile;
    if (rootChanged || !preserveState && resume?.manuscriptView) loaded = restoreManuscriptView(loaded, resume?.manuscriptView);
    if (openManuscript) loaded = { ...loaded, destination: "manuscript", previewMode: "split" };
    const seededWindow = !previous && initialWindowRequest && !initialWindowRequest.recoveryId && !hasSavedWindowState(incoming.project.id);
    if (seededWindow && initialWindowRequest) {
      loaded = applyWindowRequest(loaded, incoming, initialWindowRequest); setPreviewFormat(initialWindowRequest.format);
    }
    try { rememberProject(sessionStorage, localStorage, incoming.project.id, window.document.visibilityState === "visible"); } catch { /* Optional window navigation persistence. */ }
    const continuation = !preserveState && loaded.sourceSaveContinuation;
    const next = continuation && continuation.document.project.id === incoming.project.id && continuation.document.project.mainFile === incoming.project.mainFile
      && continuation.document.revision === incoming.revision ? continuation.document : incoming;
    // Clear in the same update as activation, not a later effect: even one frame
    // of another paper's PDF can make a reader trust the wrong manuscript.
    if (latestDocument.current?.project.id !== next.project.id
      || latestDocument.current?.project.mainFile !== next.project.mainFile
      || latestDocument.current?.project.engine !== next.project.engine) {
      setCompileResult(manuscriptBuildCache.current.read(next)); setLastFullCompile(undefined); setCompileStale(true);
      pendingRootCompile.current = manuscriptBuildIdentity(next); setRootCompileReady(undefined);
      setPreambleEditing(false);setPlainFile(undefined);
    }
    if (!preserveState || rootChanged || openManuscript) {
      setPreviewFormat(openManuscript ? "pdf" : seededWindow && initialWindowRequest ? initialWindowRequest.format : resume?.previewFormat ?? "pdf");
      setPlainFile(resume?.sourceFile && incoming.files.includes(resume.sourceFile) ? resume.sourceFile : undefined);
      setPreambleEditing(Boolean(resume?.rawEditor && (!resume.sourceFile || incoming.files.includes(resume.sourceFile))));
    }
    resumeReadyProject.current = incoming.project.id;
    setSourcePanelOpen(false); setIncomingSource(undefined); setSourceCopies([]); setSourceRefreshError(undefined);
    setReplyTaskId(undefined); setReadyReturns([]);
    const paragraphEdits = preserveState ? {} : Object.fromEntries(Object.entries(loaded.paragraphEdits).filter(([id, text]) => next.paragraphs.find((paragraph) => paragraph.id === id)?.text !== text));
    const validNodes = new Set(next.nodes.map((node) => node.id));
    const resolveNode = (id?: string) => {
      if (!id) return undefined;
      if (validNodes.has(id)) return id;
      return next.nodes.find((node) => node.paragraphIds.some((paragraphId) => paragraphId === `p-${id}` || paragraphId.startsWith(`p-${id}-`))
        || node.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").startsWith(id))?.id;
    };
    const progressByNode = { ...loaded.progressByNode };
    const firstNode = next.nodes.find((node) => node.id !== "document") ?? next.nodes[0];
    const activeNodeId = resolveNode(loaded.activeNodeId) ?? firstNode?.id ?? "document";
    const activeParagraphId = next.paragraphs.find(p => p.id === loaded.activeParagraphId && p.nodeId === activeNodeId)?.id
      ?? next.nodes.find(node => node.id === activeNodeId)?.paragraphIds[0];
    Object.entries(loaded.progressByNode).forEach(([id, progress]) => { const resolved = resolveNode(id); if (resolved && !progressByNode[resolved]) progressByNode[resolved] = progress; });
    setState({ ...loaded, progressByNode, activeNodeId, activeParagraphId,
      collapsedNodeIds: loaded.collapsedNodeIds ?? initialCollapsed(next.nodes, resolveNode(loaded.activeNodeId) ?? firstNode?.id ?? "document"),
      focusedNodeId: resolveNode(loaded.focusedNodeId),
      hiddenNodeIds: loaded.hiddenNodeIds.map(resolveNode).filter((id): id is string => Boolean(id)),
      rewriteSessions: loaded.rewriteSessions.map((session) => ({ ...session, nodeId: next.paragraphs.find((paragraph) => paragraph.id === session.paragraphId)?.nodeId ?? resolveNode(session.nodeId) ?? session.nodeId })),
      attentionTasks: loaded.attentionTasks.map((task) => ({ ...task, nodeId: resolveNode(task.nodeId) ?? task.nodeId })),
      paragraphEdits,
      draftMainFile: Object.keys(paragraphEdits).length ? loaded.draftMainFile ?? next.project.mainFile : undefined,
      sourceSaveContinuation: continuation && next === continuation.document ? continuation : undefined,
      draftRevision: Object.keys(paragraphEdits).length ? loaded.draftRevision : undefined,
    });
    setDocument(next); setDocumentEpoch((value) => value + 1); setProjectError(undefined); setAutoSaveError(undefined); setActiveRewriteId(loaded.turbo.enabled ? loaded.attentionTasks.find((task) => task.id === loaded.turbo.reviewingTaskId)?.sessionId : undefined); setActiveHandoff(undefined); setPendingSelection(undefined); setReferenceRequest(undefined); setJumpTarget(undefined); setNavigationHistory([]); setReplyTaskId(undefined);
    if (seededWindow && activeParagraphId) {
      setJumpTarget({ nodeId: activeNodeId, paragraphId: activeParagraphId, sequence: Date.now() });
      setPreviewJumpTarget({ paragraphId: activeParagraphId, sequence: ++sourceSyncSequence.current });
    } else if ((!preserveState || rootChanged || openManuscript) && loaded.destination === "manuscript" && !resume?.rawEditor) {
      const position = locateSavedPassage(resume?.sourcePosition, next, paragraphEdits);
      if (position) setJumpTarget({ nodeId: position.nodeId, paragraphId: position.id, viewportOffset: resume!.sourcePosition!.viewportOffset, sequence: Date.now() });
      else if (activeParagraphId) setJumpTarget({ nodeId: activeNodeId, paragraphId: activeParagraphId, sequence: Date.now() });
    }
    if (latestProjectId.current !== next.project.id) setReadyReturns([]);
    if (!preserveState && (loaded.draftRevision !== next.revision || loaded.draftMainFile && loaded.draftMainFile !== next.project.mainFile) && Object.keys(paragraphEdits).length) {
      if (!loaded.draftMainFile || loaded.draftMainFile === next.project.mainFile) {
        setIncomingSource(incoming); setSourcePanelOpen(true);
      }
      setAutoSaveError("This draft has an old or unknown saved version. Review file changes before saving.");
      setToast("This draft is older than the file on disk. Saving is paused to protect others' edits.");
    }
  }

  async function savePaper(retries = 0, skipCommands = false): Promise<ProjectDocument> {
    if (!skipCommands) for (const flush of [...commandFlushes.current.values()]) await flush();
    if(plainSourceFlush.current)await plainSourceFlush.current();
    while (sourceRefreshBusy.current) await new Promise(resolve => window.setTimeout(resolve, 80));
    if (saveInFlight.current) { await saveInFlight.current; return savePaper(0, skipCommands); }
    const source = latestDocument.current;
    const currentDraft = latestState.current;
    if (!source) throw new Error("Open a paper first.");
    if (!Object.keys(currentDraft.paragraphEdits).length && !currentDraft.sourceSaveContinuation) return source;
    if (currentDraft.draftMainFile && currentDraft.draftMainFile !== source.project.mainFile) throw new Error("This draft belongs to a different main file. It will be kept separately when you open a paper.");
    if (!currentDraft.draftRevision) throw new Error("The saved version of this draft is unknown. Keep a draft copy before saving.");
    const submittedEdits = { ...currentDraft.paragraphEdits };
    let retry = false;
    setSavingPaper(true);
    const operation = (async () => {
      const response = await fetch("/api/paperfocus/document", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: source.project.id, mainFile: source.project.mainFile, revision: currentDraft.draftRevision, paragraphEdits: submittedEdits, sourceRanges: currentDraft.sourceSaveContinuation?.ranges }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409 && retries < 2 && latestProjectId.current === source.project.id && latestDocument.current?.revision === source.revision) {
          const incoming = await readCurrentSource(source.project.id);
          if (latestProjectId.current !== source.project.id || latestDocument.current?.revision !== source.revision) throw new Error(result.error ?? "Unable to save this paper.");
          const element = window.document.activeElement;
          const id = element instanceof HTMLElement ? element.getAttribute("data-paragraph-id") : null;
          const offset = element instanceof HTMLElement && id ? editableCaret(element) : undefined;
          const caret = environmentCaret.current ?? (id && offset !== undefined ? { paragraphId: id, offset } : undefined);
          const refreshed = automaticSourceRefresh(latestState.current, source, incoming, caret);
          if (refreshed) {
            if (environmentChanging.current) environmentCaret.current = refreshed.caret;
            latestState.current = refreshed.state; latestDocument.current = incoming;
            setState(current => automaticSourceRefresh(current, source, incoming, caret)?.state ?? current);
            setDocument(incoming); setDocumentEpoch(value => value + 1); setIncomingSource(undefined); setSourcePanelOpen(false); setAutoSaveError(undefined);
            if (refreshed.caret && element instanceof HTMLElement) pendingSavedCaret.current = { caret: refreshed.caret, element, revision: incoming.revision, allowedIds: [id!, refreshed.caret.paragraphId] };
            retry = true; return incoming;
          }
          setIncomingSource(incoming); setSourcePanelOpen(true);
        }
        if (response.status === 409) throw new SourceSaveConflict("This passage also changed in another editor. Your draft is kept; review Source changes before compiling.");
        throw new Error(result.error ?? "Unable to save this paper.");
      }
      if (latestProjectId.current !== source.project.id || latestDocument.current?.project.mainFile !== source.project.mainFile) return result.document as ProjectDocument;
      const element = window.document.activeElement;
      const paragraphId = element instanceof HTMLElement ? element.getAttribute("data-paragraph-id") : null;
      const offset = element instanceof HTMLElement && paragraphId ? editableCaret(element) : undefined;
      const caret = environmentCaret.current ?? (paragraphId && offset !== undefined ? { paragraphId, offset } : undefined);
      const confirmed = reconcileEditorSave(latestState.current, source, result.document, submittedEdits, result.saveAcknowledgement, caret);
      if (environmentChanging.current && !confirmed.state.sourceSaveContinuation) environmentCaret.current = confirmed.caret;
      if (confirmed.caret && element instanceof HTMLElement) pendingSavedCaret.current = { caret: confirmed.caret, element, revision: result.document.revision,
        allowedIds: [paragraphId!, ...(result.saveAcknowledgement.paragraphMap[paragraphId!] ?? []).map((piece: { paragraphId: string }) => piece.paragraphId)],
        preserveEmptyTail: hasTrailingLineBreak(editableText(element)) };
      const keepEnvironmentMarks = environmentChanging.current;
      const clearSubmitted = (current: AppState) => {
        const reconciled = reconcileEditorSave(current, source, result.document, submittedEdits, result.saveAcknowledgement, caret);
        const next = keepEnvironmentMarks && !reconciled.state.sourceSaveContinuation
          ? preserveEnvironmentMarks(reconciled.state, source, result.document, result.saveAcknowledgement, submittedEdits) : reconciled.state;
        return { ...next, notebookEntries: anchorAppliedNotebookEntries(next.notebookEntries, submittedEdits, result.document) };
      };
      latestState.current = clearSubmitted(latestState.current);
      setState(clearSubmitted);
      latestDocument.current = confirmed.document; setDocument(confirmed.document); setAutoSaveError(undefined);
      announceSaved(source.project.id, "source");
      return result.document as ProjectDocument;
    })();
    saveInFlight.current = operation;
    let saved: ProjectDocument;
    try { saved = await operation; }
    finally { saveInFlight.current = undefined; setSavingPaper(false); }
    if (retry) return savePaper(retries + 1, skipCommands);
    if (latestProjectId.current === source.project.id && latestState.current.sourceSaveContinuation) {
      await new Promise(resolve => window.setTimeout(resolve, 300));
      return savePaper(0, skipCommands);
    }
    return saved;
  }

  async function saveSourceCommand(nodeId: string, closing: boolean, command: SourceCommandRange, value: string) {
    const owner = latestDocument.current;
    if (!owner) throw new Error("Open a paper first.");
    const queued = commandSaveQueue.current.catch(() => undefined).then(async () => {
    const before = await savePaper(0, true);
    if (before.project.id !== owner.project.id || before.project.mainFile !== owner.project.mainFile) throw new Error("This command belongs to the previous manuscript. Its draft is kept.");
    const node = before.nodes.find(item => item.id === nodeId), range = closing ? node?.sourceClosing : node?.sourceOpening;
    if (!range || range.file !== command.file || range.text !== command.text) throw new Error("This command changed in another editor. Your draft is kept; compare it with the saved command.");
    const operation = (async () => {
      const id = `command:${nodeId}:${closing ? "end" : "start"}`;
      const response = await fetch("/api/paperfocus/document", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({
        projectId: before.project.id, mainFile: before.project.mainFile, revision: before.revision,
        paragraphEdits: {[id]: value}, sourceRanges: [{paragraphId: id, ...range}],
      })});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "This command could not be saved. Your draft is kept.");
      if (latestDocument.current?.project.id !== before.project.id || latestDocument.current?.project.mainFile !== before.project.mainFile) return result.document as ProjectDocument;
      const next = refreshSourceState(latestState.current, before, result.document);
      latestState.current = next; latestDocument.current = result.document;
      setState(next); setDocument(result.document); setCompileStale(true); announceSaved(before.project.id, "source");
      return result.document as ProjectDocument;
    })();
    saveInFlight.current = operation;
    try { await operation; } finally { if (saveInFlight.current === operation) saveInFlight.current = undefined; }
    });
    commandSaveQueue.current = queued;
    await queued;
  }

  async function changeParagraphJoin(previousId?: string, currentId?: string, previousText?: string, currentText?: string, undo?: ParagraphJoinUndo) {
    if (paragraphJoinBusy.current || environmentChanging.current) return;
    const owner = latestDocument.current; if (!owner) return;
    paragraphJoinBusy.current = true; setEnvironmentBusy(true);
    try {
      flushParagraph(); const before = await savePaper();
      if (before.project.id !== owner.project.id || before.project.mainFile !== owner.project.mainFile) throw new Error("The manuscript changed. Your text is kept; try merging in its current view.");
      if (!undo && (before.paragraphs.find(p => p.id === previousId)?.text !== previousText || before.paragraphs.find(p => p.id === currentId)?.text !== currentText)) throw new Error("The blocks split or changed while saving. Your text is kept; press Backspace again at the current block's start.");
      if (undo && before.revision !== undo.revision) throw new Error("Source changed after the merge. Undo will not overwrite later edits; the backup is kept.");
      setSavingPaper(true);
      const operation = (async () => {
        const response = await fetch("/api/paperfocus/paragraph-join", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(undo ? { undo } : { projectId: before.project.id, mainFile: before.project.mainFile, revision: before.revision, previousId, currentId }) });
        if (response.status === 404) throw new Error("Block merging needs the updated Aw service. Restart after drafts and experiment runs have saved.");
        const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "The blocks could not be merged. Your text is kept.");
        if (latestDocument.current?.project.id !== before.project.id || latestDocument.current.project.mainFile !== before.project.mainFile) return result.document as ProjectDocument;
        const submitted: Record<string, string> = {};
        if (undo) submitted[undo.paragraphId] = undo.text.slice(0, undo.start) + undo.separator + undo.text.slice(undo.end);
        const caret = undo ? { paragraphId: undo.paragraphId, offset: undo.start + undo.separator.length } : { paragraphId: currentId!, offset: 0 };
        const confirmed = reconcileEditorSave(latestState.current, before, result.document, submitted, result.saveAcknowledgement, caret);
        latestState.current = confirmed.state; latestDocument.current = confirmed.document;
        setState(confirmed.state); setDocument(confirmed.document); setCompileStale(true); setAutoSaveError(undefined);
        paragraphJoinUndo.current = undo ? undefined : result.undo;
        if (confirmed.caret) environmentReturn.current = { caret: confirmed.caret, revision: result.document.revision };
        announceSaved(before.project.id, "source");
        setToast(undo ? "Block merge undone." : "Blocks merged · Ctrl/⌘ Z undoes this merge before later source changes.");
        return result.document as ProjectDocument;
      })();
      saveInFlight.current = operation;
      try { await operation; } finally { if (saveInFlight.current === operation) saveInFlight.current = undefined; }
    } catch (error) { setToast((error as Error).message); }
    finally { paragraphJoinBusy.current = false; setSavingPaper(false); setEnvironmentBusy(false); }
  }

  async function prepareNavigation() {
    if(plainSourceFlush.current)await plainSourceFlush.current();
    const source = latestDocument.current;
    if (!source) return;
    navigationArchive.current = undefined;
    const key = await prepareProjectNavigation(source, () => latestState.current, savePaper,
      draft => saveState({ ...draft, draftMainFile: draft.draftMainFile ?? source.project.mainFile }, source.project.id),
      async copy => {
        const response = await fetch("/api/paperfocus/source-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(copy) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "The draft copy could not be kept. Your edit is still here; try opening the paper again.");
      });
    if (key) navigationArchive.current = { projectId: source.project.id, key };
    return key ? "Unfinished edits were kept in Source changes & drafts. The manuscript source was not overwritten." : undefined;
  }

  function openPaperFiles() {
    flushParagraph(); setRepositoryOpen(true);
  }

  async function switchManuscript(file: string, create?: { title: string; kind: ManuscriptKind }) {
    const before = latestDocument.current;
    if (!before || manuscriptNavigationBusy.current) throw new Error("A manuscript is already opening. Try again in a moment.");
    if (!create && file === before.project.mainFile) { switchDestination("manuscript"); return before; }
    const candidate = create ? newManuscript(file, create.title, create.kind) : undefined;
    if (candidate) {
      const health = await (await fetch("/api/paperfocus/health")).json();
      if (create?.kind === "overview" && !health.features?.collaboratorOverview) throw new Error("Overviews need the updated Aw service. Restart after runs and drafts have saved.");
      if (!health.features?.manuscriptPurpose) throw new Error("Creating notes with a saved writing purpose needs the updated Aw service. Restart after runs and drafts have saved.");
    }
    if (candidate && before.files.some(path => path.toLowerCase() === candidate.path.toLowerCase())) throw new Error("That filename already exists. Choose another; existing source will not be replaced.");
    if (!candidate && !before.rootFiles.includes(file)) throw new Error("Choose a LaTeX root in this project.");
    manuscriptNavigationBusy.current = true; setManuscriptBusy(true);
    let created = false;
    try {
      flushParagraph(); saveWorkspaceView();
      const kept = await prepareNavigation();
      let saved = latestDocument.current!;
      if (saved.project.id !== before.project.id || saved.project.mainFile !== before.project.mainFile) throw new Error("The project changed while opening the manuscript. Your work is kept.");
      if (candidate) {
        const bytes = new TextEncoder().encode(candidate.source);
        const response = await fetch("/api/paperfocus/files", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: saved.project.id, revision: saved.revision, mainFile: saved.project.mainFile, files: [{ path: candidate.path, data: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")) }] }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not create the manuscript.");
        saved = result.document; created = true;
        const purposeResponse = await fetch("/api/paperfocus/manuscripts/purpose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: saved.project.id, mainFile: saved.project.mainFile, revision: saved.revision, file: candidate.path, purpose: create!.kind === "paper" ? "publication" : create!.kind, ...(create!.kind === "overview" ? { targetFile: before.project.mainFile, expectedTarget: "" } : {}), expectedPurpose: manuscriptPurpose(saved.project, candidate.path) }) });
        const purposeResult = await purposeResponse.json(); if (!purposeResponse.ok) throw new Error(purposeResult.error ?? "Could not save the writing purpose.");
        saved = purposeResult.document;
      }
      const response = await fetch("/api/paperfocus/projects", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select", projectId: saved.project.id, mainFile: candidate?.path ?? file, expected: { mainFile: saved.project.mainFile, revision: saved.revision } }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not open the manuscript.");
      activateDocument(result.document, true, true, true); patchState({ activeNotebookId: undefined, manuscriptPromptId: undefined }); announceSaved(saved.project.id, "source");
      if (kept) setToast(kept);
      else setToast(`${candidate?.path ?? file} opened. Notebook and other manuscripts are kept.`);
      return result.document as ProjectDocument;
    } catch (reason) {
      if (created) throw new Error(`${(reason as Error).message} The new file ${candidate!.path} was created and kept; reopen Paper & files to select it.`);
      throw reason;
    } finally { manuscriptNavigationBusy.current = false; setManuscriptBusy(false); }
  }

  async function changeManuscriptPurpose(purpose: "notes" | "overview" | "publication", targetFile?: string) {
    const before = latestDocument.current;
    if (!before || manuscriptNavigationBusy.current) throw new Error("Wait for the current manuscript operation.");
    manuscriptNavigationBusy.current = true; setManuscriptBusy(true);
    try {
      const health = await (await fetch("/api/paperfocus/health")).json();
      if (purpose === "overview" && !health.features?.collaboratorOverview) throw new Error("Overviews need the updated Aw service. Restart after runs and drafts have saved.");
      if (!health.features?.manuscriptPurpose) throw new Error("Writing purposes need the updated Aw service. Restart after runs and drafts have saved.");
      const response = await fetch("/api/paperfocus/manuscripts/purpose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: before.project.id, mainFile: before.project.mainFile, file: before.project.mainFile, revision: before.revision, purpose, expectedPurpose: manuscriptPurpose(before.project), ...(targetFile !== undefined ? { targetFile, expectedTarget: before.project.manuscriptOverviewTargets?.[before.project.mainFile] ?? "" } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not change the writing purpose.");
      const current = latestDocument.current;
      if (current?.project.id === before.project.id && current.project.mainFile === before.project.mainFile) {
        const next = { ...current, project: { ...current.project, manuscriptPurposes: result.document.project.manuscriptPurposes, manuscriptOverviewTargets: result.document.project.manuscriptOverviewTargets } };
        latestDocument.current = next; setDocument(next);
      }
      announceSaved(before.project.id, "source");
      setToast(purpose === "overview" ? "Overview · keep it short, clear and linked to the main manuscript." : purpose === "notes" ? "Research notes · full explanations welcome. Existing reviews stay intact." : "Publication draft · small writing steps and human review.");
    } finally { manuscriptNavigationBusy.current = false; setManuscriptBusy(false); }
  }

  async function transferNotebookContents(entryIds: string[], targetFile: string, mode: "move" | "copy") {
    const before = latestDocument.current;
    if (!before || manuscriptNavigationBusy.current || !notebookStorage.ready) throw new Error("Wait for saved notes and the current manuscript operation.");
    const health = await (await fetch("/api/paperfocus/health")).json();
    if (!health.features?.notebookTransfer) throw new Error("Notebook transfer needs the updated Aw service. Restart after runs and drafts have saved.");
    manuscriptNavigationBusy.current = true; setManuscriptBusy(true);
    try {
      flushParagraph(); saveWorkspaceView();
      if (await prepareNavigation()) throw new Error("Reconcile the kept source draft first.");
      await flushProjectExperimentDrafts(before.project.id);
      const notes = await notebookStorage.flush(), saved = latestDocument.current!;
      if (saved.project.id !== before.project.id || saved.project.mainFile !== before.project.mainFile) throw new Error("The manuscript changed during preparation.");
      const response = await fetch("/api/paperfocus/notebook/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: saved.project.id, mainFile: saved.project.mainFile, revision: saved.revision, notebookRevision: notes.revision, entryIds, targetFile, mode }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not transfer notes.");
      notebookStorage.accept(result.notebook);
      if (mode === "move" && entryIds.includes(latestState.current.activeNotebookId ?? "")) patchState({ activeNotebookId: undefined });
      announceSaved(saved.project.id, "notebook");
      setToast(`${entryIds.length} conversations ${mode === "move" ? "moved" : "copied"} to ${targetFile}. Current manuscript unchanged.`);
    } finally { manuscriptNavigationBusy.current = false; setManuscriptBusy(false); }
  }

  async function newVersion(file: string, fresh: boolean) {
    const before = latestDocument.current;
    if (!before || manuscriptNavigationBusy.current) throw new Error("Wait for the current manuscript operation.");
    if (!workbenchStorage.ready || workbenchStorage.pending || workbenchStorage.saving || workbenchStorage.error) throw new Error("Wait for comments and reviewed wording to finish saving before making a version.");
    const health = await (await fetch("/api/paperfocus/health")).json();
    if (!health.features?.manuscriptVersions) throw new Error("New versions need the updated Aw service. Restart it after runs and drafts have saved.");
    manuscriptNavigationBusy.current = true; setManuscriptBusy(true);
    try {
      flushParagraph(); saveWorkspaceView();
      const kept = await prepareNavigation();
      if (kept) throw new Error("Reconcile the kept source draft before making a new version.");
      await flushProjectExperimentDrafts(before.project.id);
      const notes = await notebookStorage.flush(), saved = latestDocument.current!;
      if (saved.project.id !== before.project.id || saved.project.mainFile !== before.project.mainFile) throw new Error("The manuscript changed while preparing the version.");
      const response = await fetch("/api/paperfocus/manuscripts/version", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: saved.project.id, mainFile: saved.project.mainFile, revision: saved.revision, notebookRevision: notes.revision, file, notebook: fresh ? "fresh" : "continue" }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not make the version.");
      const active = latestState.current.activeNotebookId;
      activateDocument(result.document, true, true); notebookStorage.accept(result.notebook); workbenchStorage.accept(result.workbench);
      patchState({ activeNotebookId: active ? result.entryMapping[active] : undefined, manuscriptPromptId: undefined });
      announceSaved(saved.project.id, "source"); announceSaved(saved.project.id, "notebook");
      setToast(`${file} · v.${result.version.number} opened. ${fresh ? "Fresh notebook." : "Notebook continued; previous work kept."}`);
    } finally { manuscriptNavigationBusy.current = false; setManuscriptBusy(false); }
  }

  async function saveSectionFile(file: string, title: string, nodeId?: string) {
    if (manuscriptNavigationBusy.current) throw new Error("Wait for the current manuscript operation.");
    manuscriptNavigationBusy.current = true; setManuscriptBusy(true);
    try {
      flushParagraph(); const saved = await savePaper();
      const response = await fetch("/api/paperfocus/files/section", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: saved.project.id, mainFile: saved.project.mainFile, revision: saved.revision, file, title, nodeId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not create the section file.");
      const next = activateSectionResult(result);
      setSectionUndo({ projectId: saved.project.id, mainFile: saved.project.mainFile, revision: next.revision, operationId: result.operationId });
      setToast(`${result.file} is included by ${result.parentFile}. Edit all sections together or select This section. Undo is available.`);
      return next;
    } finally { manuscriptNavigationBusy.current = false; setManuscriptBusy(false); }
  }

  function activateSectionResult(result: { document: ProjectDocument; relocations: Array<{ before: Paragraph; after: Paragraph }> }) {
      const next = result.document, relocations = result.relocations;
      const current = latestState.current;
      const nodeMap = new Map(relocations.map(pair => [pair.before.nodeId, pair.after.nodeId]));
      const relocated = { ...current, activeNodeId: nodeMap.get(current.activeNodeId) ?? current.activeNodeId,
        activeParagraphId: relocations.find(pair => pair.before.id === current.activeParagraphId)?.after.id ?? current.activeParagraphId,
        focusedNodeId: current.focusedNodeId ? nodeMap.get(current.focusedNodeId) ?? current.focusedNodeId : undefined,
        hiddenNodeIds: current.hiddenNodeIds.map(id => nodeMap.get(id) ?? id), collapsedNodeIds: current.collapsedNodeIds?.map(id => nodeMap.get(id) ?? id),
        progressByNode: Object.fromEntries(Object.entries(current.progressByNode).map(([id, progress]) => [nodeMap.get(id) ?? id, progress])),
        notebookEntries: current.notebookEntries.map(entry => {
          const source = entry.source; if (!source || source.rootFile && source.rootFile !== next.project.mainFile) return entry;
          const relocate = (capturedSource: NonNullable<NotebookEntry["source"]>) => {
            const captured = capturedSource.returnAnchor ?? capturedSource;
            const pair = relocations.find(pair => pair.before.id === captured.paragraphId && pair.before.file === captured.file && pair.before.text === captured.paragraphText);
            return pair ? { ...capturedSource, returnAnchor: { rootFile: next.project.mainFile, paragraphId: pair.after.id, file: pair.after.file, paragraphText: pair.after.text, revision: next.revision,
              duplicateAtCapture: next.paragraphs.filter(p => p.file === pair.after.file && p.text === pair.after.text).length > 1 } } : capturedSource;
          };
          return { ...entry, source: { ...relocate(source), ...(source.passages ? { passages: source.passages.map(relocate) } : {}) } };
        }) };
      latestState.current = relocated;
      activateDocument(next, true, true); setCompileStale(true); announceSaved(next.project.id, "source");
      return next;
  }

  async function undoSectionChange() {
    if (!sectionUndo || manuscriptNavigationBusy.current) return;
    manuscriptNavigationBusy.current = true; setManuscriptBusy(true);
    try {
      flushParagraph(); const saved = await savePaper();
      if (saved.project.id !== sectionUndo.projectId || saved.project.mainFile !== sectionUndo.mainFile || saved.revision !== sectionUndo.revision) throw new Error("Source changed since the section operation. Undo will not overwrite your later edits; the recovery copy is kept.");
      const response = await fetch("/api/paperfocus/files/section/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sectionUndo) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not undo this section change.");
      activateSectionResult(result); setSectionUndo(undefined);
      setToast(result.warning ?? `Section change undone. The unchanged child ${result.file} was removed; its contents remain in Source changes & drafts.`);
    } catch (reason) { setToast((reason as Error).message); }
    finally { manuscriptNavigationBusy.current = false; setManuscriptBusy(false); }
  }

  async function copyPassageLink() {
    try {
      const before = latestDocument.current; if (!before) return;
      const id = handoffParagraphId; flushParagraph(); await savePaper();
      const saved = latestDocument.current!;
      if (saved.project.id !== before.project.id || saved.project.mainFile !== before.project.mainFile) throw new Error("The manuscript changed before copying the link.");
      const url = manuscriptPassageUrl(location.href, saved, latestState.current, latestState.current.activeParagraphId ?? id);
      if (!url) throw new Error("Select a saved manuscript paragraph first.");
      await navigator.clipboard.writeText(url); setToast("Passage link copied. Use it as a return link beside notebook evidence.");
    } catch (reason) { setToast((reason as Error).message); }
  }

  async function openLinkedSource() {
    if (!initialWindowRequest || !document) return;
    const request = initialWindowRequest;
    try {
      const next = await switchManuscript(request.rootFile);
      setState(current => applyWindowRequest(current, next, request));
      setPreviewFormat(request.format);
      const paragraph = next.revision === request.revision && next.paragraphs.find(p => p.id === request.paragraphId);
      if (paragraph) setJumpTarget({ nodeId: paragraph.nodeId, paragraphId: paragraph.id, sequence: Date.now() });
      setLinkedSourceOpened(true);
      if (!paragraph && (request.revision || request.paragraphId)) setToast("The linked saved version differs from current source. The correct manuscript is open; choose its current passage. No location was guessed.");
      else if (!paragraph) setToast("Linked manuscript opened. The selected root is shared across this project's windows.");
    } catch (reason) { setToast((reason as Error).message); }
  }

  useEffect(() => {
    if (!document || linkedSourceAutoAttempt.current || linkedSourceOpened || manuscriptBusy || compiling || savingPaper) return;
    if (!automaticLinkedManuscript(initialWindowRequest, document, latestState.current, preambleEditing)) return;
    linkedSourceAutoAttempt.current = true;
    void openLinkedSource();
  }, [document?.project.id, document?.project.mainFile, linkedSourceOpened, manuscriptBusy, compiling, savingPaper, preambleEditing]);

  async function openPlainSource(file?:string,preamble=false,sourceOffset?:number){
    try{await savePaper();if(!latestDocument.current)return false;
      setPlainFile(file ?? latestDocument.current.project.mainFile);setPendingSelection(undefined);window.getSelection()?.removeAllRanges();
      setPreambleEditing(true);
      patchState({destination:"manuscript",lens:"paper",previewMode:latestState.current.previewMode==="full"?"split":latestState.current.previewMode});
      if(preamble)setJumpTarget({nodeId:"preamble",sequence:Date.now()});
      else if(sourceOffset!==undefined)setJumpTarget({nodeId:latestState.current.activeNodeId,sourceOffset,sequence:Date.now()});
      return true;
    }catch(reason){setToast((reason as Error).message);return false;}
  }
  async function toggleSourceBlocks(){
    try{await savePaper();patchState({sourcePresentation:latestState.current.sourcePresentation==="blocks"?"plain":"blocks"});}
    catch(reason){setToast((reason as Error).message);}
  }

  async function openSourceFile(file: string, raw = false) {
    if (!document) return;
    const target = sourceFileTarget(document, file);
    if (raw || !target) {if(await openPlainSource(file,true))setRepositoryOpen(false);return;}
    flushParagraph();
    navigationArchive.current = undefined;
    const ancestors = new Set<string>();
    let node = document.nodes.find(item => item.id === target.nodeId);
    while (node && !ancestors.has(node.id)) { ancestors.add(node.id); node = document.nodes.find(item => item.id === node?.parentId); }
    patchState({ destination: "manuscript", lens: "paper", activeNodeId: target.nodeId, activeParagraphId: target.paragraphId,
      focusedNodeId: target.nodeId, blockWindow: undefined, hiddenNodeIds: state.hiddenNodeIds.filter(id => !ancestors.has(id)), collapsedNodeIds: (state.collapsedNodeIds ?? []).filter(id => !ancestors.has(id)), turbo: { ...state.turbo, enabled: false } });
    setJumpTarget({ ...target, sequence: Date.now() }); setRepositoryOpen(false);
  }

  async function readCurrentSource(projectId: string) {
    const response = await fetch(`/api/paperfocus/document?projectId=${encodeURIComponent(projectId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to read the current source.");
    return result as ProjectDocument;
  }

  const receiveWindowSource = useStableEvent(async () => {
    const before = latestDocument.current;
    if (!before || manuscriptNavigationBusy.current || sourceRefreshBusy.current || saveInFlight.current || pendingSelection || environmentChanging.current) return;
    sourceRefreshBusy.current = true;
    try {
      const incoming = await readCurrentSource(before.project.id);
      if (saveInFlight.current || latestDocument.current?.revision !== before.revision || latestDocument.current.project.id !== before.project.id) return;
      if (incoming.revision === before.revision && incoming.project.mainFile === before.project.mainFile && incoming.project.engine === before.project.engine) {
        // Policy-only refresh: preserve the draft, selection, layout and compiled PDF.
        if ((JSON.stringify(incoming.project.manuscriptPurposes) !== JSON.stringify(before.project.manuscriptPurposes) || JSON.stringify(incoming.project.manuscriptOverviewTargets) !== JSON.stringify(before.project.manuscriptOverviewTargets))) {
          const next = { ...latestDocument.current, project: incoming.project };
          latestDocument.current = next; setDocument(next);
        }
        return;
      }
      const active = window.document.activeElement;
      const id = active instanceof HTMLElement ? active.getAttribute("data-paragraph-id") : null;
      const offset = active instanceof HTMLElement && id ? editableCaret(active) : undefined;
      const caret = id && offset !== undefined ? { paragraphId: id, offset } : undefined;
      const refreshed = automaticSourceRefresh(latestState.current, before, incoming, caret);
      if (!refreshed) {
        if (incoming.revision !== before.revision && incoming.project.mainFile === before.project.mainFile && incoming.project.engine === before.project.engine) {
          const plan = sourceRefreshPlan(before, incoming, latestState.current.paragraphEdits, latestState.current.draftRevision);
          if (plan.conflicts.length) { setIncomingSource(incoming); setSourcePanelOpen(true); }
        }
        return; // Present overlapping versions; never silently replace the live draft.
      }
      const position = sourcePositionReader.current?.(), viewTarget = position && sourceRefreshPlan(before, incoming, {}, before.revision).mapping.get(position.paragraphId);
      latestState.current = refreshed.state; latestDocument.current = incoming;
      setState(current => automaticSourceRefresh(current, before, incoming, caret)?.state ?? current);
      setDocument(incoming); setCompileStale(true);
      setIncomingSource(undefined); setSourcePanelOpen(false);
      if (viewTarget && position && !caret) setJumpTarget({ nodeId: viewTarget.nodeId, paragraphId: viewTarget.id, viewportOffset: position.viewportOffset, sequence: Date.now() });
      if (refreshed.caret && active instanceof HTMLElement) pendingSavedCaret.current = { caret: refreshed.caret, element: active, revision: incoming.revision, allowedIds: [id!, refreshed.caret.paragraphId] };
    } catch { /* Keep the existing editor and let the source monitor report persistent changes. */ }
    finally { sourceRefreshBusy.current = false; }
  });
  useEffect(() => subscribeWindowMessages(message => { if (message.kind === "source" && message.projectId === latestDocument.current?.project.id) void receiveWindowSource(); }), [receiveWindowSource]);
  useEffect(() => { if (sourceMonitor.changed) void receiveWindowSource(); }, [sourceMonitor.changed, sourceMonitor.revision, pendingSelection, savingPaper, receiveWindowSource]);

  function openWorkspaceWindow(panel: WindowPanel, recoveryId?: string) {
    const doc = latestDocument.current; if (!doc) return;
    flushParagraph();
    const target = new URL(windowWorkspaceUrl(window.location.href, doc, latestState.current, panel, previewFormat));
    if (recoveryId) target.searchParams.set("awRecover", recoveryId);
    const url = target.href;
    setWindowFallbackUrl(url);
    const companion = window.open("about:blank", "_blank", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
    if (!companion) { setToast("The window was blocked. Use Open as tab in Advanced settings."); return; }
    try {
      // The new blank window is same-origin; discard only its copied view/draft cache.
      resetCompanionSession(companion.sessionStorage); companion.opener = null; companion.location.replace(url);
      if (panel === "preview" && !recoveryId) { showLatexLayout("hidden"); patchState({ detachedPreview: true }); }
      setToast("Window opened. Drag it to your monitor; its location and zoom are independent.");
    } catch { companion.close(); setToast("Use Open as tab in Advanced settings instead. This view was not changed."); }
  }

  async function checkSourceFiles() {
    if (!document || sourceRefreshBusy.current) return;
    const projectId = document.project.id;
    sourceRefreshBusy.current = true; setSourceRefreshing(true); setSourcePanelOpen(true); setSourceRefreshError(undefined);
    try {
      if (saveInFlight.current) await saveInFlight.current.catch(() => undefined);
      const next = await readCurrentSource(projectId);
      if (latestProjectId.current !== projectId) return;
      if (next.project.mainFile !== latestDocument.current?.project.mainFile) throw new Error("The main LaTeX file changed in another window. Use Paper & files to reopen this paper; unfinished drafts are kept.");
      setIncomingSource(next);
      const response = await fetch(`/api/paperfocus/source-drafts?projectId=${encodeURIComponent(projectId)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Saved source drafts could not be read.");
      if (latestProjectId.current === projectId) setSourceCopies(result);
    } catch (error) { if (latestProjectId.current === projectId) setSourceRefreshError(error instanceof Error ? error.message : String(error)); }
    finally { sourceRefreshBusy.current = false; setSourceRefreshing(false); }
  }

  async function refreshSourceFiles() {
    if (!document || sourceRefreshBusy.current) return;
    const projectId = document.project.id;
    sourceRefreshBusy.current = true; setSourceRefreshing(true); setSourceRefreshError(undefined);
    try {
      if (saveInFlight.current) await saveInFlight.current.catch(() => undefined);
      const before = latestDocument.current;
      const incoming = await readCurrentSource(projectId);
      if (!before || latestProjectId.current !== projectId) return;
      if (incoming.project.mainFile !== before.project.mainFile) throw new Error("The main LaTeX file changed in another window. Reopen this paper from Paper & files; unfinished drafts are kept.");
      const current = latestState.current;
      const plan = sourceRefreshPlan(before, incoming, current.paragraphEdits, current.draftRevision);
      const draftKey = JSON.stringify([current.paragraphEdits, current.draftRevision]);
      let copy: SourceDraftCopy | undefined;
      if (plan.conflicts.length) {
        const response = await fetch("/api/paperfocus/source-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          version: 1, projectId, rootFile: before.project.mainFile, baseRevision: current.draftRevision ?? before.revision,
          incomingRevision: incoming.revision, drafts: plan.conflicts,
        }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The draft copy could not be saved. Refresh stopped.");
        copy = result;
        // The user may keep typing during the disk save. Never clear that newer draft.
        if (JSON.stringify([latestState.current.paragraphEdits, latestState.current.draftRevision]) !== draftKey) throw new Error("Your draft changed during refresh. The earlier copy is safe; check files again to preserve the newest text.");
        const verified = await readCurrentSource(projectId);
        if (verified.revision !== incoming.revision) throw new Error("Files changed again. Your draft copy is kept; check again when the other app finishes writing.");
      }
      if (latestProjectId.current !== projectId || latestDocument.current?.revision !== before.revision) return;
      if (JSON.stringify([latestState.current.paragraphEdits, latestState.current.draftRevision]) !== draftKey) throw new Error("Your draft changed during refresh. Check files again before replacing the source view.");
      const nextState = refreshSourceState(latestState.current, before, incoming);
      // Write the safe rebased state before replacing the editable DOM.
      saveState(nextState, projectId);
      latestState.current = nextState; latestDocument.current = incoming;
      setState(nextState); setDocument(incoming); setDocumentEpoch((value) => value + 1);
      setIncomingSource(undefined); setPendingSelection(undefined); setJumpTarget(undefined); setNavigationHistory([]);
      window.getSelection()?.removeAllRanges(); setAutoSaveError(undefined); setCompileStale(true);
      if (copy) { setSourceCopies((copies) => [copy!, ...copies].slice(0, 20)); setSourcePanelOpen(true); }
      else setSourcePanelOpen(false);
      setToast(copy ? "Files refreshed. Conflicting drafts are kept in Draft recovery." : "Files refreshed. Your view and edits to unchanged passages are kept.");
    } catch (error) { if (latestProjectId.current === projectId) setSourceRefreshError(error instanceof Error ? error.message : String(error)); }
    finally { sourceRefreshBusy.current = false; setSourceRefreshing(false); }
  }

  function switchDestination(destination: AppState["destination"]) {
    flushParagraph();
    if (destination === "manuscript" && state.destination !== "manuscript" && document) {
      if (preambleEditing) setJumpTarget(undefined);
      else {
        const saved = manuscriptReturnPositions.current.get(`${document.project.id}:${document.project.mainFile}`);
        const paragraph = locateSavedPassage(saved, document, latestState.current.paragraphEdits);
        if (saved && paragraph) {
          setJumpTarget({nodeId: paragraph.nodeId, paragraphId: paragraph.id, viewportOffset: saved.viewportOffset, sequence: Date.now()});
          setState(current => ({...current, activeNodeId: paragraph.nodeId, activeParagraphId: paragraph.id,
            blockWindow: current.blockWindow ? {...current.blockWindow, paragraphId: paragraph.id} : undefined,
            turbo: current.turbo.enabled ? {...current.turbo, activeParagraphId: paragraph.id} : current.turbo}));
        } else setJumpTarget(undefined);
      }
    }
    setMobileOutlineOpen(false);
    setManuscriptPromptOpen(false);
    setActiveRewriteId(undefined); setActiveHandoff(undefined); setLatexAssistantOpen(false); setReferenceRequest(undefined); setPendingSelection(undefined);
    patchState({ destination });
  }

  function exploreSelection() {
    if (!document) return;
    const selection = pendingSelection;
    if (selection && !captureSelection(selection)) return;
    const paragraph = paragraphs.find((p) => p.id === (selection?.paragraphId ?? (state.turbo.enabled ? turboParagraph?.id : state.activeParagraphId))) ?? paragraphs.find((p) => p.nodeId === activeNode.id);
    const text = paragraph ? flushParagraph(paragraph.id) : undefined;
    const linked = selection ?? (paragraph ? { paragraphId: paragraph.id, nodeId: paragraph.nodeId, start: 0, end: text?.length ?? 0, text: text ?? "", x: 0, y: 0 } : undefined);
    setState((current) => {
      const entry = newNotebookEntry(document, { ...current, paragraphEdits: paragraph && text !== undefined ? { ...current.paragraphEdits, [paragraph.id]: text } : current.paragraphEdits }, linked);
      return { ...current, destination: "notebook", notebookEntries: [...current.notebookEntries, entry], activeNotebookId: entry.id };
    });
    setActiveRewriteId(undefined); setActiveHandoff(undefined); setLatexAssistantOpen(false); setReferenceRequest(undefined); setPendingSelection(undefined); window.getSelection()?.removeAllRanges();
  }

  function newQuestion() {
    if (!document) return;
    const entry = newNotebookEntry(document, state);
    setState((current) => ({ ...current, destination: "notebook", notebookEntries: [...current.notebookEntries, entry], activeNotebookId: entry.id }));
  }

  function askInManuscript(forceNew = false, selected?: PendingSelection, question?: string) {
    if (!document) return;
    setReviewOpen(false);
    setWritingOpen(false);
    const selection = selected ?? pendingSelection;
    if (selection && !captureSelection(selection)) return;
    const paragraph = paragraphs.find((p) => p.id === (selection?.paragraphId ?? (state.turbo.enabled ? turboParagraph?.id : state.activeParagraphId))) ?? paragraphs.find((p) => p.nodeId === activeNode.id);
    const text = paragraph ? flushParagraph(paragraph.id) : "";
    const linked = selection ?? (paragraph ? { paragraphId: paragraph.id, nodeId: paragraph.nodeId, start: 0, end: text.length, text, x: 0, y: 0 } : undefined);
    const oldPassage = locateSavedPassage(manuscriptPrompt?.source, document, latestState.current.paragraphEdits);
    const sameBlocks = JSON.stringify(selection?.spans?.map(span => [span.paragraphId, span.start, span.end, span.text])) === JSON.stringify(manuscriptPrompt?.source?.passages?.map(p => [p.paragraphId, p.start, p.end, p.excerpt]));
    if (forceNew || !manuscriptPrompt || !sameBlocks || oldPassage?.id !== paragraph?.id || selection && (selection.start !== manuscriptPrompt.source?.start || selection.end !== manuscriptPrompt.source?.end)) {
      const entry = newNotebookEntry(document, latestState.current, linked);
      if (question) { entry.question = question; entry.route = "codex"; }
      setState((current) => ({ ...current, notebookEntries: [...current.notebookEntries, entry], manuscriptPromptId: entry.id, activeNotebookId: entry.id }));
    }
    setManuscriptPromptOpen(true); setActiveRewriteId(undefined); setActiveHandoff(undefined); setLatexAssistantOpen(false); setReferenceRequest(undefined); setPendingSelection(undefined);
    window.getSelection()?.removeAllRanges();
  }

  function patchNotebook(id: string, patch: Partial<NotebookEntry>) {
    setState((current) => {
      const now = new Date().toISOString();
      const latestHandoffId = current.notebookEntries.find((entry) => entry.id === id)?.handoffs.at(-1)?.id;
      return { ...current, notebookEntries: current.notebookEntries.map((entry) => entry.id === id ? { ...entry, ...patch, updatedAt: now } : entry),
        attentionTasks: current.attentionTasks.map((task) => {
          if (task.status === "reviewed") return task;
          const turn = task.notebookId === id ? patch.study?.turns.find((turn) => turn.id === task.studyTurnId) : undefined;
          if (turn?.closed) return { ...task, status: "reviewed" as const, updatedAt: now };
          if (turn && !turn.jobId) return { ...task, reply: turn.reply, replyDraft: turn.reply, status: turn.status, updatedAt: now };
          return (turn?.status === "ready" && turn.reply.trim()) || (patch.reply?.trim() && !task.studyTurnId && task.id === latestHandoffId)
            ? { ...task, status: "ready" as const, updatedAt: now } : task;
        }) };
    });
  }

  async function returnFromNotebook(entry: NotebookEntry) {
    if (!entry.source) { switchDestination("manuscript"); return; }
    let sourceDocument = document;
    if (entry.source.rootFile && entry.source.rootFile !== sourceDocument?.project.mainFile) {
      try { sourceDocument = await switchManuscript(entry.source.rootFile); }
      catch (reason) { setToast((reason as Error).message); return; }
    }
    const paragraph = sourceDocument && locateSavedPassage(entry.source, sourceDocument, latestState.current.paragraphEdits);
    if (!paragraph) { setToast("The linked passage changed or its location is uncertain. Your question is kept; choose its current passage in Manuscript view."); return; }
    const ancestors = new Set([paragraph.nodeId]);
    let parent = sourceDocument!.nodes.find((node) => node.id === paragraph.nodeId)?.parentId;
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = sourceDocument!.nodes.find((node) => node.id === parent)?.parentId; }
    setState((current) => ({ ...current, destination: "manuscript", lens: entry.returnView?.lens === "themes" ? "paper" : entry.returnView?.lens ?? "paper",
      activeNodeId: paragraph.nodeId, activeParagraphId: paragraph.id, focusedNodeId: entry.returnView && !entry.returnView.focusedNodeId || entry.returnView?.blockWindow ? undefined : paragraph.nodeId, previewMode: entry.returnView?.previewMode ?? current.previewMode,
      blockWindow: entry.returnView?.blockWindow ? { ...entry.returnView.blockWindow, paragraphId: paragraph.id } : undefined,
      hiddenNodeIds: current.hiddenNodeIds.filter((id) => !ancestors.has(id)),
      collapsedNodeIds: current.collapsedNodeIds?.filter((id) => !ancestors.has(id)),
      turbo: { ...current.turbo, enabled: Boolean(entry.returnView?.turboEnabled), activeParagraphId: paragraph.id, atEnd: false } }));
    setJumpTarget({ nodeId: paragraph.nodeId, paragraphId: paragraph.id, sequence: Date.now() });
  }

  function openLinkedNotebook(entry: NotebookEntry) {
    switchDestination("notebook");
    setState(current => ({ ...toggleNotebookConversation(current, entry.id, true), manuscriptPromptId: entry.id }));
  }

  async function navigateNotebookPhase(entry: NotebookEntry) {
    const owner = latestDocument.current;
    if (!owner) return;
    await navigateSavedPhase(async () => {
      await flushProjectExperimentDrafts(owner.project.id);
      await notebookStorage.flush();
      if (entry.manuscriptFile && entry.manuscriptFile !== latestDocument.current?.project.mainFile) await switchManuscript(entry.manuscriptFile);
      if (latestDocument.current?.project.id !== owner.project.id || !latestState.current.notebookEntries.some(item => item.id === entry.id)) throw new Error("The phase catalogue changed. Choose the phase again.");
    }, () => {
      setState(current => phaseSelection(current, entry.id));
      const currentDocument = latestDocument.current;
      if (currentDocument) history.replaceState(null, "", windowWorkspaceUrl(location.href, currentDocument, phaseSelection(latestState.current, entry.id), "notebook", previewFormat));
    });
  }

  function applyNotebookProposal(entry: NotebookEntry) {
    const paragraph = document && locateSavedPassage(entry.source, document, latestState.current.paragraphEdits);
    const result = proposalReplacement(entry, paragraph ? paragraphText(latestState.current, paragraph.id, paragraphs) : undefined);
    if (result.error || result.text === undefined || !entry.source) { setToast(result.error); return; }
    if (!paragraph) { setToast("The original passage can't be found reliably. Choose it again before replacing text."); return; }
    updateParagraph(paragraph.id, result.text);
    const now = new Date().toISOString();
    patchNotebook(entry.id, { status: "integrated", proposal: "",
      source: { ...entry.source, paragraphId: paragraph.id, nodeId: paragraph.nodeId, paragraphText: result.text, excerpt: entry.proposal, end: entry.source.start + entry.proposal.length },
      appliedChanges: [...entry.appliedChanges, { before: entry.source.excerpt, after: entry.proposal, createdAt: now }] });
    setState((current) => archiveReadyNotebookTasks(current, entry.id));
    returnFromNotebook(entry);
    setToast("Passage updated and saved. Mathematics hasn't been checked.");
  }

  async function prepareNotebookHandoff(entry: NotebookEntry, packet: string, turn?: StudyTurn): Promise<string> {
    if (!document) throw new Error("Choose a paper before copying a prompt.");
    const projectId = document.project.id;
    if (latestProjectId.current !== projectId) throw new Error("The paper changed while preparing this question. Retry in the intended paper.");
    const now = new Date().toISOString();
    const id = turn?.id ?? crypto.randomUUID();
    // Request snapshots are immutable, but typing/options changed during evidence
    // loading must not be replaced by the submission's older entry object.
    setState(current => ({ ...current, notebookEntries: current.notebookEntries.map(item => item.id === entry.id ? {
      ...item, title: notebookTitle(item), updatedAt: now,
      handoffs: [...item.handoffs, { id, packet, createdAt: now, studyTurnId: turn?.id }],
      ...(turn ? { study: { ...studyState(item), turns: [...studyState(item).turns, turn], activeTurnId: turn.id } } : {}),
    } : item) }));
    setState((current) => queueAttentionTask(current, { id, notebookId: entry.id, studyTurnId: turn?.id, title: `${entry.route} · ${turn ? studyActions[turn.action] : entry.title}`, nodeId: entry.source?.nodeId ?? current.activeNodeId,
      paragraphId: entry.source?.paragraphId, sourceSnapshot: notebookTaskSource(entry, document), previousTaskId: turn?.previousTurnId, route: entry.route, packet, status: "queued", createdAt: now, updatedAt: now }));
    try {
      const ticket = await exportHandoff(projectId, packet, entry.route, { id, label: entry.study?.handoff?.label,
        ...(turn && entry.route === "codex" ? { notebookTarget: { entryId: entry.id, notebookId: entry.experimentNotebookId ?? entry.id } } : {}) });
      if (latestProjectId.current !== projectId) throw new Error("Prompt saved for the previous paper. Reopen it to continue.");
      setState((current) => ({ ...current,
        attentionTasks: current.attentionTasks.map((task) => task.id === id ? { ...task, ticket, handoffPath: ticket.promptPath, title: `${ticket.label} · ${turn ? studyActions[turn.action] : entry.title}` } : task),
        notebookEntries: current.notebookEntries.map((item) => item.id === entry.id && item.study && turn ? { ...item, updatedAt: new Date().toISOString(), study: { ...item.study, turns: item.study.turns.map((saved) => saved.id === turn.id ? { ...saved, ticket } : saved) } } : item) }));
      setToast("Prompt saved. Nothing sent. Keep working while you wait.");
      return ticket.copyText;
    } catch (error) {
      if (latestProjectId.current === projectId) setState((current) => ({ ...current, attentionTasks: current.attentionTasks.map((task) => task.id === id ? { ...task, status: "failed", error: "Couldn't save the prompt file. Your prompt is kept in the queue; retry or finish it explicitly." } : task) }));
      throw error;
    }
  }

  async function runNotebookStudy(entry: NotebookEntry, turn: StudyTurn) {
    if (!document) return;
    const projectId = document.project.id;
    if (latestProjectId.current !== projectId) return;
    const study = studyState(entry);
    const model = localModelForEffort(study.localModel, study.localEffort);
    setSavingHandoff(true);
    try {
      const response = await fetch("/api/paperfocus/local-study", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, entryId: entry.id, packet: turn.packet, model, effort: study.localEffort, guidance: turn.guidance, secondLook: turn.secondLookRequested, sourceRevision: document.revision, fresh: turn.previousTurnId ? turn.id : undefined }) });
      const job = await response.json();
      if (!response.ok || !job.id) throw new Error(job.error ?? "Couldn't start this request.");
      if (latestProjectId.current !== projectId) return;
      const now = new Date().toISOString();
      const task: AttentionTask = { id: turn.id, notebookId: entry.id, studyTurnId: turn.id, title: `Local · ${studyActions[turn.action]}`, nodeId: entry.source?.nodeId ?? latestState.current.activeNodeId,
        paragraphId: entry.source?.paragraphId, sourceSnapshot: notebookTaskSource(entry, document), route: "local", localJobId: job.id, previousTaskId: turn.previousTurnId, status: "working", createdAt: now, updatedAt: now };
      setState((current) => {
        const queued = queueAttentionTask(current, task);
        return { ...queued, notebookEntries: queued.notebookEntries.map((item) => item.id === entry.id ? { ...item, title: notebookTitle(item), updatedAt: now, study: { ...studyState(item), activeTurnId: turn.id, turns: [...studyState(item).turns, { ...turn, model, jobId: job.id }] } } : item) };
      });
      continueUsefulWork(task);
      setToast("Working on this computer. A Return button appears when ready; your view and manuscript stay unchanged.");
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
    finally { setSavingHandoff(false); }
  }

  function patchState(patch: Partial<AppState>) {
    setState((current) => {
      const currentNodes=latestDocument.current?.nodes ?? manuscriptNodes,currentParagraphs=latestDocument.current?.paragraphs ?? paragraphs;
      const firstProof = currentNodes.find((node) => ["theorem", "lemma", "corollary", "proof"].includes(node.kind));
      const nextTheme = current.themeLenses.find((theme) => theme.id === (patch.activeThemeId ?? current.activeThemeId));
      const themeIds = new Set(nextTheme?.matches.filter((match) => !match.excluded).map((match) => match.paragraphId));
      const themeParagraph = currentParagraphs.find((paragraph) => paragraph.id === current.activeParagraphId && themeIds.has(paragraph.id)) ?? currentParagraphs.find((paragraph) => themeIds.has(paragraph.id));
      const lensContext = patch.lens === "proofs" && current.lens !== "proofs" ? { focusedNodeId: undefined, ...(firstProof ? { activeNodeId: firstProof.id, activeParagraphId: firstProof.paragraphIds[0] } : {}) }
        : patch.lens === "paper" && current.lens === "themes" ? { focusedNodeId: current.activeNodeId }
        : ((patch.lens === "themes" && current.lens !== "themes") || patch.activeThemeId) && themeParagraph ? { activeNodeId: themeParagraph.nodeId, activeParagraphId: themeParagraph.id } : {};
      return { ...current, ...lensContext, ...patch, ...(patch.activeNotebookId ? { collapsedNotebookIds: (current.collapsedNotebookIds ?? []).filter((id) => id !== patch.activeNotebookId) } : {}), ...(patch.lens && patch.lens !== "paper" ? { turbo: { ...current.turbo, enabled: false } } : {}) };
    });
  }

  async function changeLens(lens:Lens){
    try{
      if(preambleEditing){await savePaper();setPreambleEditing(false);}else flushParagraph();
      setPendingSelection(undefined);window.getSelection()?.removeAllRanges();patchState({lens});
    }catch(reason){setToast((reason as Error).message);}
  }

  function flushParagraph(id = state.turbo.enabled ? turboParagraph?.id : state.activeParagraphId) {
    if (!id) return "";
    const element = window.document.querySelector<HTMLElement>(`p[data-paragraph-id="${CSS.escape(id)}"][contenteditable="true"]`);
    const baseline = paragraphText(latestState.current, id, paragraphs);
    const live = element ? editableText(element) : baseline;
    // A retained, already-saved blank box is not a fresh source insertion every
    // time a toolbar action flushes it. Actual typing clears this marker.
    const text = element?.dataset.savedEmptyTail && live.trimEnd() === baseline.trimEnd() ? baseline : live;
    updateParagraph(id, text);
    return text;
  }

  function patchTurbo(patch: Partial<TurboState>) {
    flushParagraph();
    setState((current) => ({ ...current, turbo: { ...current.turbo, ...patch } }));
  }

  function toggleTurbo() {
    const position = sourcePositionReader.current?.();
    flushParagraph();
    setReviewOpen(false);
    setActiveRewriteId(undefined); setActiveHandoff(undefined); setReferenceRequest(undefined); setLatexAssistantOpen(false); setPendingSelection(undefined);
    if (state.turbo.enabled) {
      const target = turboParagraph;
      setState((current) => ({ ...current, ...current.turbo.returnView, lens: "paper", activeNodeId: target?.nodeId ?? current.activeNodeId, activeParagraphId: target?.id ?? current.activeParagraphId,
        focusedNodeId: current.turbo.returnView?.focusedNodeId ? target?.nodeId : undefined,
        blockWindow: current.turbo.returnView?.blockWindow ? { ...current.turbo.returnView.blockWindow, paragraphId: target?.id } : undefined,
        turbo: { ...current.turbo, enabled: false, reviewingTaskId: undefined, resumeParagraphId: undefined, pendingPrompt: undefined } }));
      if (target) setJumpTarget({ nodeId: target.nodeId, paragraphId: target.id, viewportOffset: position?.viewportOffset, sequence: Date.now() });
      return;
    }
    const start = pass.find(p => p.id === (position?.paragraphId ?? state.activeParagraphId)) ?? pass.find(p => p.nodeId === state.activeNodeId) ?? pass[0];
    setState((current) => ({ ...current, lens: "paper", focusedNodeId: undefined, previewMode: "split", activeNodeId: start?.nodeId ?? current.activeNodeId, activeParagraphId: start?.id,
      turbo: { ...current.turbo, enabled: true, activeParagraphId: start?.id, atEnd: false, returnView: { lens: current.lens, activeNodeId: current.activeNodeId, focusedNodeId: current.focusedNodeId, previewMode: current.previewMode, blockWindow: current.blockWindow } } }));
    if (start) setJumpTarget({ nodeId: start.nodeId, paragraphId: start.id, viewportOffset: position?.viewportOffset, sequence: Date.now() });
    setPreviewJumpTarget({ paragraphId: start?.id, sequence: ++sourceSyncSequence.current });
    setToast("Turbo wording pass: scroll forward or Check & next. No automatic compilation.");
  }

  async function changeManuscriptScope(scope: ManuscriptScope) {
    if (scopeChanging) return;
    setScopeChanging(true);
    try {
    const position = sourcePositionReader.current?.();
    const paragraphId = preambleEditing ? state.activeParagraphId : position?.paragraphId ?? (state.turbo.enabled ? turboParagraph?.id : blockWindow?.activeId) ?? state.activeParagraphId;
    const nodeId = paragraphs.find(p => p.id === paragraphId)?.nodeId ?? state.activeNodeId;
    const projectId = document?.project.id, root = document?.project.mainFile;
    if (preambleEditing) await savePaper();
    if (latestDocument.current?.project.id !== projectId || latestDocument.current?.project.mainFile !== root) return;
    setPreambleEditing(false);
    flushParagraph(); setPendingSelection(undefined);
    setState(current => chooseManuscriptScope({ ...current, activeNodeId: nodeId, activeParagraphId: paragraphId,
      blockWindow: current.blockWindow ? { ...current.blockWindow, paragraphId } : undefined }, scope, manuscriptNodes));
    setJumpTarget({ nodeId, paragraphId, viewportOffset: position?.viewportOffset, sequence: Date.now() });
    if (projectId && root) { setScopeCompileRequest(manuscriptBuildIdentity(latestDocument.current!)); setCompileStale(true); }
    // Reading follows the anchor; PDF scope changes save/build or reuse a cached artifact.
    setPreviewJumpTarget({ paragraphId, sequence: ++sourceSyncSequence.current });
    } catch (reason) { setToast((reason as Error).message); }
    finally { setScopeChanging(false); }
  }

  function moveBlockWindow(direction: -1 | 1) {
    if (!blockWindow || turboBlocked) return;
    const target = blockWindow.available[blockWindow.index + direction];
    if (!target) return;
    flushParagraph(); setPendingSelection(undefined);
    setState(current => ({ ...current, activeNodeId: target.nodeId, activeParagraphId: target.id,
      focusedNodeId: undefined, blockWindow: current.blockWindow ? { ...current.blockWindow, paragraphId: target.id } : undefined }));
    setJumpTarget({ nodeId: target.nodeId, paragraphId: target.id, sequence: Date.now() });
  }

  async function moveSection(direction: -1 | 1) {
    if (!sectionNavigation || sectionNavigation.blocked || sectionMoveBusy.current) return;
    sectionMoveBusy.current = true; setSectionMoving(true);
    const owner = latestDocument.current;
    const departingSection = latestState.current.focusedNodeId;
    try {
      flushParagraph(); const saved = await savePaper();
      if (!owner || saved.project.id !== owner.project.id || saved.project.mainFile !== owner.project.mainFile) return;
      if (latestDocument.current?.project.id !== owner.project.id || latestDocument.current?.project.mainFile !== owner.project.mainFile) return;
      const current = latestState.current;
      if (!current.focusedNodeId || current.focusedNodeId !== departingSection || current.blockWindow || current.turbo.enabled || current.lens !== "paper" || current.destination !== "manuscript") return;
      const target = adjacentManuscriptSection(saved.nodes, current.focusedNodeId, current.hiddenNodeIds, direction);
      if (!target) return;
      const included = new Set([target.id]);
      for (const node of saved.nodes) if (node.parentId && included.has(node.parentId)) included.add(node.id);
      const candidates = saved.paragraphs.filter(p => included.has(p.nodeId));
      const paragraph = direction < 0 ? candidates.at(-1) : candidates[0];
      const edge = direction < 0 ? "end" : "start";
      setState(value => ({...value, activeNodeId: paragraph?.nodeId ?? target.id, activeParagraphId: paragraph?.id, focusedNodeId: target.id}));
      setJumpTarget({nodeId: target.id, paragraphId: paragraph?.id, edge, sequence: Date.now()});
      setScopeCompileRequest(manuscriptBuildIdentity(saved)); setCompileStale(true);
      setPreviewJumpTarget({paragraphId: paragraph?.id, edge, sequence: ++sourceSyncSequence.current});
    } catch (reason) { setToast((reason as Error).message); }
    finally { sectionMoveBusy.current = false; setSectionMoving(false); }
  }

  function scrollBlockWindow(paragraphId: string) {
    if (!blockWindow || turboBlocked || pendingSelection || !window.getSelection()?.isCollapsed) return;
    const target = blockWindow.available.find(p => p.id === paragraphId);
    if (!target || target.id === blockWindow.activeId) return;
    flushParagraph();
    setState(current => ({ ...current, activeNodeId: target.nodeId, activeParagraphId: target.id,
      focusedNodeId: undefined, blockWindow: current.blockWindow ? { ...current.blockWindow, paragraphId: target.id } : undefined }));
    // Native scroll owns the position. Do not recenter or mark work checked.
  }

  function focusTurboParagraph(id: string) {
    const paragraph = pass.find((item) => item.id === id);
    if (!paragraph) return;
    flushParagraph();
    setPendingSelection(undefined); window.getSelection()?.removeAllRanges();
    setState((current) => ({ ...current, activeNodeId: paragraph.nodeId, activeParagraphId: id, turbo: { ...current.turbo, activeParagraphId: id, atEnd: false } }));
    setJumpTarget({ nodeId: paragraph.nodeId, paragraphId: id, sequence: Date.now() });
    setPreviewJumpTarget({ paragraphId: id, sequence: ++sourceSyncSequence.current });
  }

  function scrollTurboParagraph(id: string) {
    if (!turboParagraph || turboBlocked || state.turbo.reviewingTaskId || pendingSelection || !window.getSelection()?.isCollapsed) return;
    const target = pass.find(p => p.id === id);
    if (!target || target.id === turboParagraph.id) return;
    const text = flushParagraph();
    const waiting = openTasks.some(task => task.paragraphId === turboParagraph.id);
    setState(current => ({ ...current, activeNodeId: target.nodeId, activeParagraphId: target.id,
      turbo: scrollTurbo(current.turbo, pass, target.id, text, waiting) }));
    // The reel preserves the source viewport. Only the reading preview follows.
    setPreviewJumpTarget({ paragraphId: id, sequence: ++sourceSyncSequence.current });
  }

  function navigateNode(nodeId: string, paragraphId?: string) {
    if (state.turbo.enabled) {
      const target = pass.find((paragraph) => paragraph.id === paragraphId) ?? pass.find((paragraph) => paragraph.nodeId === nodeId);
      if (target) { focusTurboParagraph(target.id); return; }
      flushParagraph(); patchTurbo({ enabled: false });
      setToast("Paused Turbo to open a block outside the wording pass. Its position is saved.");
    }
    const ancestors = new Set([nodeId]);
    let parent = manuscriptNodes.find((node) => node.id === nodeId)?.parentId;
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = manuscriptNodes.find((node) => node.id === parent)?.parentId; }
    const targetId = paragraphId ?? paragraphs.find((p) => p.nodeId === nodeId)?.id;
    setState((current) => ({ ...current, destination: "manuscript", lens: "paper", activeNodeId: nodeId, focusedNodeId: current.blockWindow ? undefined : nodeId, activeParagraphId: targetId,
      blockWindow: current.blockWindow ? { ...current.blockWindow, paragraphId: targetId } : undefined,
      hiddenNodeIds: current.hiddenNodeIds.filter((id) => !ancestors.has(id)), collapsedNodeIds: current.collapsedNodeIds?.filter((id) => !ancestors.has(id)) }));
  }

  function moveTurbo(direction: "previous" | "skip" | "next" | "start" | "remaining", reason: "next" | "scroll" = "next") {
    if (!turboParagraph) return;
    const text = flushParagraph();
    const waiting = openTasks.some((task) => task.paragraphId === turboParagraph.id);
    const index = turboWindow.index;
    const target = direction === "start" ? pass[0] : direction === "remaining" ? pass.find((paragraph) => !reviewed(state.turbo, paragraph.id, paragraphText(state, paragraph.id, paragraphs)) && !openTasks.some((task) => task.paragraphId === paragraph.id))
      : pass[direction === "previous" ? Math.max(0, index - 1) : index + 1];
    setState((current) => {
      const turbo = direction === "next" && !waiting ? checkParagraph(current.turbo, turboParagraph.id, text, reason) : current.turbo;
      return { ...current, activeNodeId: target?.nodeId ?? current.activeNodeId, activeParagraphId: target?.id ?? turboParagraph.id, turbo: { ...turbo, activeParagraphId: target?.id ?? turboParagraph.id, atEnd: !target } };
    });
    if (target) { setJumpTarget({ nodeId: target.nodeId, paragraphId: target.id, sequence: Date.now() }); setPreviewJumpTarget({ paragraphId: target.id, sequence: ++sourceSyncSequence.current }); }
    setPendingSelection(undefined); window.getSelection()?.removeAllRanges();
    if (waiting && direction === "next") setToast("Moved on; linked work is still open, so this paragraph stays unchecked.");
    if (!target) setToast(direction === "remaining" ? "Remaining paragraphs have open linked work." : "End of pass. Skipped paragraphs and those with open linked work stay unchecked.");
  }

  function undoTurbo() {
    flushParagraph();
    setState((current) => {
      const turbo = undoCheck(current.turbo);
      const paragraph = paragraphs.find((item) => item.id === turbo.activeParagraphId);
      return { ...current, turbo, activeNodeId: paragraph?.nodeId ?? current.activeNodeId, activeParagraphId: paragraph?.id ?? current.activeParagraphId };
    });
    const target = pass.find(p => p.id === state.turbo.history.at(-1)?.paragraphId);
    if (target) { setJumpTarget({ nodeId: target.nodeId, paragraphId: target.id, sequence: Date.now() }); setPreviewJumpTarget({ paragraphId: target.id, sequence: ++sourceSyncSequence.current }); }
    setToast("Last wording check undone. Text edits are preserved.");
  }

  function jumpToLabel(label: DocumentLabel, returnParagraphId = referenceRequest?.paragraphId) {
    const ancestors = new Set([label.nodeId]);
    let parent = manuscriptNodes.find((node) => node.id === label.nodeId)?.parentId;
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = manuscriptNodes.find((node) => node.id === parent)?.parentId; }
    flushParagraph();
    setNavigationHistory((previous) => [...previous.slice(-15), { lens: state.lens, activeNodeId: state.activeNodeId, focusedNodeId: state.focusedNodeId, hiddenNodeIds: state.hiddenNodeIds, previewMode: state.previewMode, blockWindow: state.blockWindow, returnParagraphId, turboCursor: state.turbo.enabled ? turboParagraph?.id : undefined }]);
    const turboTarget = pass.find((paragraph) => paragraph.id === label.paragraphId) ?? pass.find((paragraph) => paragraph.nodeId === label.nodeId);
    setState((current) => ({ ...current, lens: "paper", activeNodeId: label.nodeId, focusedNodeId: label.nodeId,
      blockWindow: undefined,
      turbo: { ...current.turbo, enabled: current.turbo.enabled && Boolean(turboTarget), activeParagraphId: turboTarget?.id ?? current.turbo.activeParagraphId, atEnd: false },
      hiddenNodeIds: current.hiddenNodeIds.filter((id) => !ancestors.has(id)), collapsedNodeIds: current.collapsedNodeIds?.filter((id) => !ancestors.has(id)), previewMode: current.previewMode === "full" ? "split" : current.previewMode }));
    setReferenceRequest(undefined); setPendingSelection(undefined); setJumpTarget({ ...label, sequence: Date.now() });
    setToast(`Jumped to ${label.key} · ${label.file}:${label.line}`);
  }
  function openReference(request: ReferenceRequest) {
    setActiveRewriteId(undefined); setActiveHandoff(undefined); setLatexAssistantOpen(false); setPendingSelection(undefined);
    const labels = document?.labels?.filter((label) => request.token.keys.length === 1 && label.key === request.token.keys[0]) ?? [];
    if (request.token.kind === "label" && !request.inspect && labels.length === 1) jumpToLabel(labels[0], request.paragraphId);
    else {
      setReferenceRequest(request);
      const paragraph = paragraphs.find((item) => item.id === request.paragraphId);
      if (paragraph) setJumpTarget({ nodeId: paragraph.nodeId, paragraphId: paragraph.id, sequence: Date.now() });
    }
  }

  function patchRewrite(
    sessionId: string,
    updates: Partial<RewriteSession> | ((session: RewriteSession) => RewriteSession),
  ) {
    setState((current) => ({
      ...current,
      rewriteSessions: current.rewriteSessions.map((session) => {
        if (session.id !== sessionId) return session;
        if (typeof updates === "function") return updates(session);
        return { ...session, ...updates, updatedAt: new Date().toISOString() };
      }),
    }));
  }

  function openSavedRewrite(id: string) {
    const session = state.rewriteSessions.find((item) => item.id === id);
    if (!session) return;
    const source = paragraphs.some((paragraph) => paragraph.id === session.paragraphId) ? flushParagraph(session.paragraphId) : undefined;
    if (!rewriteSourceMatches(session, source, paragraphId => paragraphs.some(p => p.id === paragraphId) ? flushParagraph(paragraphId) : undefined)) patchRewrite(id, { status: "stale" });
    patchState({ activeNodeId: session.nodeId, activeParagraphId: session.paragraphId });
    setReplyTaskId(undefined); setActiveHandoff(undefined); setLatexAssistantOpen(false); setReferenceRequest(undefined); setPendingSelection(undefined);
    setActiveRewriteId(id);
  }

  function showRewrite(selection: Pick<PendingSelection, "paragraphId" | "nodeId" | "start" | "end" | "text" | "spans">, source?: string) {
    setReferenceRequest(undefined);
    setActiveHandoff(undefined); setLatexAssistantOpen(false);
    const sourceHash = fingerprint(selection.text);
    const cached = state.rewriteSessions.find(
      (session) =>
        session.paragraphId === selection.paragraphId &&
        session.start === selection.start &&
        session.end === selection.end &&
        session.sourceFingerprint === sourceHash &&
        JSON.stringify(session.selectionSpans) === JSON.stringify(selection.spans) &&
        session.status === "draft",
    );
    if (cached) {
      setActiveRewriteId(cached.id);
    } else {
      const created = createRewriteSession({
        ...selection,
        paragraphText: source ?? paragraphText(latestState.current, selection.paragraphId, paragraphs),
      });
      if (state.turbo.enabled) created.instruction += " Polish wording only. Keep claims, notation, commands, citations, labels and comments unchanged. Do not reorganize the argument or add claims.";
      setState((current) => ({
        ...current,
        rewriteSessions: [...current.rewriteSessions, created],
      }));
      setActiveRewriteId(created.id);
    }
    setPendingSelection(undefined);
    window.getSelection()?.removeAllRanges();
  }

  function requestRewrite(selection: Pick<PendingSelection, "paragraphId" | "nodeId" | "start" | "end" | "text" | "spans">, source?: string) {
    const ready = !selection.spans && state.turbo.enabled && !state.turbo.reviewingTaskId ? openTasks.find((task) => task.turbo && task.status === "ready" && task.sessionId && pass.some((paragraph) => paragraph.id === task.paragraphId)) : undefined;
    if (ready) {
      patchTurbo({ pendingPrompt: selection });
      returnToTask(ready);
      setPendingSelection(undefined); window.getSelection()?.removeAllRanges();
      setToast("A linked reply is ready. Review it, then resume this new prompt at your saved position.");
    } else showRewrite(selection, source);
  }

  function beginRewrite() {
    if (!pendingSelection) return;
    if (!captureSelection(pendingSelection)) return;
    const source = flushParagraph(pendingSelection.paragraphId);
    requestRewrite(pendingSelection, source);
  }

  function polishTurboParagraph() {
    if (!turboParagraph) return;
    const text = flushParagraph();
    requestRewrite({ paragraphId: turboParagraph.id, nodeId: turboParagraph.nodeId, start: 0, end: text.length, text }, text);
  }

  function resumeTurboReply(revisedText?: string) {
    const task = state.attentionTasks.find((item) => item.id === state.turbo.reviewingTaskId);
    const pending = state.turbo.pendingPrompt;
    const text = revisedText ?? flushParagraph(task?.paragraphId);
    const finishing = task && task.review?.kind !== "comment" && (task.status === "ready" || revisedText !== undefined);
    const resume = paragraphs.find((paragraph) => paragraph.id === state.turbo.resumeParagraphId);
    setState((current) => {
      const othersWaiting = current.attentionTasks.some((item) => item.id !== task?.id && item.paragraphId === task?.paragraphId && ["queued", "working", "ready"].includes(item.status));
      const turbo = finishing && task.paragraphId && !othersWaiting ? checkParagraph(current.turbo, task.paragraphId, text, "reply") : current.turbo;
      return { ...current, activeNodeId: resume?.nodeId ?? current.activeNodeId,
        attentionTasks: current.attentionTasks.map((item) => item.id === task?.id && finishing ? { ...item, status: "reviewed", updatedAt: new Date().toISOString() } : item),
        turbo: { ...turbo, activeParagraphId: resume?.id ?? turbo.activeParagraphId, reviewingTaskId: undefined, resumeParagraphId: undefined, pendingPrompt: undefined, atEnd: false } };
    });
    setActiveRewriteId(undefined); setActiveHandoff(undefined);
    if (pending) {
      const current = pending.paragraphId === task?.paragraphId && revisedText !== undefined ? revisedText : paragraphText(latestState.current, pending.paragraphId, paragraphs);
      if (current.slice(pending.start, pending.end) === pending.text) showRewrite(pending, current);
      else setToast("Forward position restored. That pending selection changed; highlight it again to rewrite safely.");
    }
  }

  function createThemeFromSelection() {
    if (!pendingSelection || !captureSelection(pendingSelection)) return;
    const themeId = `theme-${Date.now()}`;
    const theme = {
      id: themeId,
      name: themeNameFromSelection(pendingSelection.text),
      seedParagraphId: pendingSelection.paragraphId,
      matches: rankRelevantParagraphs(
        pendingSelection.text,
        paragraphs,
        state.paragraphEdits,
        pendingSelection.paragraphId,
      ),
      drafts: [],
    };
    setState((current) => ({
      ...current,
      lens: "themes",
      turbo: { ...current.turbo, enabled: false },
      themeLenses: [...current.themeLenses, theme],
      activeThemeId: themeId,
    }));
    setPendingSelection(undefined);
    window.getSelection()?.removeAllRanges();
    setToast(`Created “${theme.name}” with ${theme.matches.length} matched passages.`);
  }

  function updateParagraph(paragraphId: string, nextText: string) {
    const original = latestDocument.current?.paragraphs.find((item) => item.id === paragraphId)?.text ?? "";
    if (nextText === (latestState.current.paragraphEdits[paragraphId] ?? original)) return;
    const change = (current: AppState): AppState => {
      const edits = { ...current.paragraphEdits };
      if (nextText === original) delete edits[paragraphId];
      else edits[paragraphId] = nextText;
      return {
        ...current,
        paragraphEdits: edits,
        draftRevision: Object.keys(edits).length ? current.draftRevision ?? latestDocument.current?.revision : undefined,
        rewriteSessions: current.rewriteSessions.some(session => (session.selectionSpans ?? [{ paragraphId: session.paragraphId }]).some(span => span.paragraphId === paragraphId) && !["applied", "stale"].includes(session.status)) ? current.rewriteSessions.map((session) => {
          if (!(session.selectionSpans ?? [{ paragraphId: session.paragraphId }]).some(span => span.paragraphId === paragraphId) || session.status === "applied") return session;
          return rewriteSourceMatches(session, nextText, id => id === paragraphId ? nextText : paragraphs.some(p => p.id === id) ? paragraphText(current, id, paragraphs) : undefined)
            ? session
            : { ...session, status: "stale" };
        }) : current.rewriteSessions,
      };
    };
    latestState.current = change(latestState.current); setState(change);
    setCompileStale(true);
  }

  function applyRewrite(session: RewriteSession) {
    const candidate = session.candidates.find(
      (item) => item.id === session.selectedCandidateId && !item.dismissed,
    );
    if (!candidate) return;
    const currentText = paragraphText(state, session.paragraphId, paragraphs);
    const replacement = selectedRewriteEdits(session, candidate.text, id => paragraphs.some(p => p.id === id) ? paragraphText(latestState.current, id, paragraphs) : undefined);
    if (!replacement.edits) {
      if (replacement.error?.includes("changed")) patchRewrite(session.id, { status: "stale" });
      setToast(replacement.error); return;
    }
    if (!session.selectionSpans && currentText.slice(session.start, session.end) !== session.sourceText) {
      patchRewrite(session.id, { status: "stale" });
      setToast("The source changed. Re-select this passage before applying.");
      return;
    }
    const revised = replacement.edits[session.paragraphId];
    if ((state.turbo.enabled || session.selectionSpans) && Object.entries(replacement.edits).some(([id, text]) => !sameProtectedLatex(paragraphText(latestState.current, id, paragraphs), text))) {
      setToast("This phrasing changes protected LaTeX or math. Keep those parts in their original blocks; make intentional technical changes directly in the source.");
      return;
    }
    setState((current) => ({
      ...current,
      paragraphEdits: { ...current.paragraphEdits, ...replacement.edits },
      draftRevision: current.draftRevision ?? document?.revision,
      rewriteSessions: current.rewriteSessions.map((item) => {
        if (item.id === session.id) {
          return { ...item, status: "applied", updatedAt: new Date().toISOString() };
        }
        if ((item.selectionSpans ?? [{ paragraphId: item.paragraphId }]).some(span => span.paragraphId in replacement.edits!) && item.status === "draft") {
          return { ...item, status: "stale", updatedAt: new Date().toISOString() };
        }
        return item;
      }),
      attentionTasks: current.attentionTasks.map((task) => task.sessionId === session.id && !current.turbo.reviewingTaskId ? { ...task, status: "reviewed", updatedAt: new Date().toISOString() } : task),
    }));
    setActiveRewriteId(undefined);
    if (state.turbo.reviewingTaskId) resumeTurboReply(revised);
    setCompileStale(true);
    setToast("Replacement applied to the local working copy.");
  }

  function addCandidate(session: RewriteSession) {
    const candidate: RewriteCandidate = {
      id: `candidate-${Date.now()}`,
      text: session.sourceText,
      source: "Your phrasing",
      dismissed: false,
      userEdited: true,
    };
    patchRewrite(session.id, (current) => ({
      ...current,
      candidates: [...current.candidates, candidate],
      selectedCandidateId: candidate.id,
      updatedAt: new Date().toISOString(),
    }));
  }

  function generateMore(session: RewriteSession) {
    patchRewrite(session.id, (current) => ({
      ...current,
      candidates: [...current.candidates, ...(session.selectionSpans ? generateSelectionCandidates(session.selectionSpans) : generateRuleCandidates(session.sourceText))],
      updatedAt: new Date().toISOString(),
    }));
  }

  function nextUsefulPlace() {
    setReviewOpen(false);
    continueUsefulWork();
  }

  async function useChunk(action: ChunkAction, selection: PendingSelection) {
    if (!captureSelection(selection)) return;
    const text = flushParagraph(selection.paragraphId);
    if (!selection.spans && text.slice(selection.start, selection.end) !== selection.text) { setToast("This block changed. Select it again; your notes are kept."); return; }
    if (action === "rewrite") requestRewrite(selection, text);
    else if (action === "ask") askInManuscript(false, selection);
    else if (action === "comment") addReviewComment(selection);
    else if (action === "later") toggleLater(selection);
    else if (selection.spans) {
      const id = `selection-${crypto.randomUUID()}`;
      const ids = [...new Set(selection.spans.map(span => span.paragraphId))];
      setState(current => ({ ...current, lens: "themes", turbo: { ...current.turbo, enabled: false }, activeThemeId: id,
        themeLenses: [...current.themeLenses, { id, name: "Selected blocks", seedParagraphId: selection.paragraphId, matches: ids.map(paragraphId => ({ paragraphId, score: 1, pinned: true })), drafts: [] }] }));
      setPendingSelection(undefined); window.getSelection()?.removeAllRanges();
    }
    else {
      // Save first so a freshly split block has its own confirmed source identity.
      const element = window.document.querySelector<HTMLElement>(`p[data-paragraph-id="${CSS.escape(selection.paragraphId)}"][contenteditable="true"]`);
      element?.focus(); if (element) restoreEditableCaret(element, selection.start);
      const projectId = latestDocument.current?.project.id;
      try {
        await savePaper();
        if (latestDocument.current?.project.id !== projectId) return;
        const id = pendingSavedCaret.current?.caret.paragraphId ?? latestState.current.activeParagraphId ?? selection.paragraphId;
        const p = latestDocument.current?.paragraphs.find(p => p.id === id);
        if (!p) return;
        setPendingSelection(undefined); window.getSelection()?.removeAllRanges();
        patchState({ lens:"paper",activeParagraphId: p.id, activeNodeId: p.nodeId, focusedNodeId: undefined, blockWindow: { paragraphId: p.id, radius: 0 } });
        setJumpTarget({ nodeId: p.nodeId, paragraphId: p.id, sequence: Date.now() });
      } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
    }
  }
  const blockHasContext=useStableEvent((id:string,text:string,start:number,end:number)=>{
    const kept=!!latestDocument.current && emptyChunkHasContext(latestState.current,latestDocument.current,id,text,start,end);
    if(kept)setToast("This block has linked notes or comments. They are kept; review them before removing the block.");
    return kept;
  });

  function captureSelection(selection: PendingSelection) {
    try {
      if (!selectionPassages(selection).length || selectionPassages(selection).length > 200) throw new Error("Select between 1 and 200 blocks at a time.");
      const values = new Map<string, string>();
      for (const span of selectionPassages(selection)) if (!values.has(span.paragraphId)) values.set(span.paragraphId, flushParagraph(span.paragraphId));
      verifySelection(selection, id => { const p = paragraphs.find(p => p.id === id); return p ? { nodeId: p.nodeId, text: values.get(id) ?? p.text } : undefined; });
      return true;
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); return false; }
  }

  const changeBlockType = useStableEvent(async (selection: QueuedPassage, environment: string, fields?: EnvironmentFields) => {
    if (environmentChanging.current) return;
    const initial = latestDocument.current;
    const node = initial?.nodes.find(n => n.id === selection.nodeId);
    if (!initial || !node || initial.structureIssue) return;
    if ((node.environment ?? "") === environment && !fields) return;
    environmentChanging.current = true;
    try {
      const text = flushParagraph(selection.paragraphId);
      validateEnvironmentFields(fields);
      const primaryLabel=initial.labels?.find(label=>label.nodeId===node.id);
      if(fields?.label && initial.labels?.some(label=>label.key===fields.label && label!==primaryLabel))throw new Error("This reference label is already used elsewhere in the paper.");
      if(fields){
        const health=await fetch("/api/paperfocus/health").then(response=>response.json());
        if(!health.features?.environmentHeadings)throw new Error("Restart Active Writing to save heading names and labels. Your entries are kept.");
      }
      if (text.slice(selection.start, selection.end) !== selection.text) throw new Error("This block changed. Choose its type again.");
      if (environment && !initial.environmentOptions?.some(option => option.name === environment)) throw new Error("Choose a type declared in this paper's preamble.");
      if (node.environment && !node.canChangeEnvironment) throw new Error("This wrapper crosses files or is incomplete. Edit its commands in Source instead.");
      environmentCaret.current = { paragraphId: selection.paragraphId, offset: selection.start };
      const element = window.document.querySelector<HTMLElement>(`.manuscript-page p[data-paragraph-id="${CSS.escape(selection.paragraphId)}"]`);
      element?.focus({ preventScroll: true }); if (element) restoreEditableCaret(element, selection.start);
      if (!node.environment) {
        if (fields?.label && initial.labels?.some(label=>label.key===fields.label)) throw new Error("This reference label is already used elsewhere in the paper.");
        const wrapped = wrapSourceBlock(text, selection.start, selection.end, selection.text, environment, fields);
        environmentCaret.current.offset += wrapped.length - text.length - `\n\\end{${environment}}`.length;
        updateParagraph(selection.paragraphId, wrapped);
      }
      setEnvironmentBusy(true);
      await savePaper();
      if (latestDocument.current?.project.id !== initial.project.id || latestDocument.current.project.mainFile !== initial.project.mainFile) return;
      if (Object.keys(latestState.current.paragraphEdits).length || latestState.current.sourceSaveContinuation) throw new Error("Your latest typing is kept. Wait for it to save, then choose the type again.");
      const source = latestDocument.current, caret = environmentCaret.current;
      const paragraph = source.paragraphs.find(p => p.id === caret?.paragraphId);
      if (!paragraph) throw new Error("The block's new location could not be confirmed. Its source and notes are kept.");
      if (node.environment) {
        const currentNode = source.nodes.find(n => n.id === paragraph.nodeId);
        if (currentNode?.environment !== node.environment || !currentNode.canChangeEnvironment) throw new Error("This environment changed while saving. Choose its type again.");
        setSavingPaper(true);
        const operation = (async () => {
          const response = await fetch("/api/paperfocus/document", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: source.project.id, mainFile: source.project.mainFile, revision: source.revision, environmentChange: { nodeId: currentNode.id, environment, fields } }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Unable to change this type. Your text is kept.");
          if (latestDocument.current?.project.id !== source.project.id || latestDocument.current.project.mainFile !== source.project.mainFile) return result.document as ProjectDocument;
          const metadataEdits:Record<string,string> = {};
          for(const p of source.paragraphs) { const range=result.saveAcknowledgement?.sourceRanges.find((r:{paragraphId:string;text:string})=>r.paragraphId===p.id); if(range && range.text!==p.text) metadataEdits[p.id]=range.text; }
          const confirmed = reconcileEditorSave(latestState.current, source, result.document, metadataEdits, result.saveAcknowledgement, caret);
          const next = { ...preserveEnvironmentMarks(confirmed.state, source, result.document, result.saveAcknowledgement,metadataEdits), ...(environment ? {} : { lens: "paper" as const }) };
          latestState.current = next; setState(next); latestDocument.current = confirmed.document; setDocument(confirmed.document);
          announceSaved(source.project.id, "source");
          environmentCaret.current = confirmed.caret;
          return result.document as ProjectDocument;
        })();
        saveInFlight.current = operation;
        try { await operation; } finally { saveInFlight.current = undefined; setSavingPaper(false); }
      }
      if (latestDocument.current?.project.id !== initial.project.id || latestDocument.current.project.mainFile !== initial.project.mainFile) return;
      const target = latestDocument.current.paragraphs.find(p => p.id === environmentCaret.current?.paragraphId);
      if (target) {
        environmentReturn.current = { caret: { paragraphId: target.id, nodeId: target.nodeId, offset: environmentCaret.current?.offset ?? 0 }, revision: latestDocument.current.revision };
        setJumpTarget({ nodeId: target.nodeId, paragraphId: target.id, sequence: Date.now() });
      }
      setCompileStale(true); setPendingSelection(undefined);
      setToast(environment ? fields ? "Heading saved. Text and notes kept." : "Block type changed. Text and notes kept." : "Wrapper removed. Text, labels and notes kept.");
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
    finally { environmentCaret.current = undefined; environmentChanging.current = false; setEnvironmentBusy(false); }
  });
  const blockTypes = useMemo<BlockTypes | undefined>(() => document && !document.structureIssue
    ? { options: document.environmentOptions ?? [], labels: document.labels, onChange: changeBlockType } : undefined,
    [document?.environmentOptions, document?.labels, document?.structureIssue, changeBlockType]);

  function openReview(task?: AttentionTask, blockId?: string) {
    setReviewBlockId(blockId);
    setWritingOpen(false);
    const first = !task && openTasks.find(t => t.review?.kind === "comment");
    if (first) task = first;
    setState(current => current.destination === "manuscript" ? current : { ...current, destination: "manuscript" });
    setReviewOpen(true);
    setReviewTaskId(task?.id ?? openTasks.find(t => t.review?.kind === "comment")?.id);
    setReplyTaskId(undefined); setActiveHandoff(undefined); setActiveRewriteId(undefined); setLatexAssistantOpen(false); setReferenceRequest(undefined);
  }
  function openWriting(task?: AttentionTask) {
    flushParagraph();
    const existing = task ?? [...latestState.current.attentionTasks].reverse().find(t => t.writing && t.status !== "reviewed");
    setWritingTaskId(existing?.id); setWritingOpen(true); setReviewOpen(false);
    setState(current => ({ ...current, destination: "manuscript" }));
    setReplyTaskId(undefined); setActiveHandoff(undefined); setActiveRewriteId(undefined); setLatexAssistantOpen(false); setReferenceRequest(undefined); setManuscriptPromptOpen(false);
  }
  async function prepareWriting(scope: WritingScope, route: "codex" | "chatgpt", previousRoundId?: string) {
    const doc = latestDocument.current;
    if (!doc) throw new Error("Choose a manuscript first.");
    flushParagraph();
    const current = latestState.current;
    if (previousRoundId && current.attentionTasks.some(t => t.writing?.kind === "paragraph" && t.writing.roundId === previousRoundId && t.status !== "reviewed")) throw new Error("Review or set aside the previous round's paragraphs first.");
    const snapshot = writingSnapshot(doc, current.paragraphEdits, scope, current.activeNodeId, current.activeParagraphId ?? doc.paragraphs.find(p => p.nodeId === current.activeNodeId)?.id, activeTheme);
    const locked = writingLocks(current.attentionTasks, doc, current.paragraphEdits);
    const task = makeWritingRequest(snapshot, current.handoffDrafts?.writing?.instruction ?? "", scope, route, { previousRoundId, lockedParagraphIds: snapshot.paragraphs.filter(p => locked.has(p.id)).map(p => p.id), settledNotes: writingDecisions(current.attentionTasks, previousRoundId), ...(scope === "theme" ? { themeName: activeTheme?.name } : {}) });
    setSavingHandoff(true);
    setState(saved => queueAttentionTask(saved, task)); openWriting(task);
    try {
      const ticket = await exportHandoff(doc.project.id, task.packet!, route, { id: task.id, label: "Writing round" });
      if (latestProjectId.current !== doc.project.id) return;
      setState(saved => ({ ...saved, attentionTasks: saved.attentionTasks.map(t => t.id === task.id ? { ...t, ticket, handoffPath: ticket.promptPath, error: undefined } : t) }));
      try { await navigator.clipboard.writeText(ticket.copyText); setToast("Writing instructions copied. Each proposed paragraph will need your review."); }
      catch { setToast("Writing request saved. Use Copy instructions in the writing panel."); }
    } catch (error) {
      if (latestProjectId.current === doc.project.id) setState(saved => ({ ...saved, attentionTasks: saved.attentionTasks.map(t => t.id === task.id ? { ...t, error: (error as Error).message } : t) }));
      throw error;
    } finally { setSavingHandoff(false); }
  }
  async function changeWriting(id: string, action: "place" | "approve" | "drop", reviewedText?: string) {
    flushParagraph();
    const doc = latestDocument.current;
    if (!doc || manuscriptNavigationBusy.current || saveInFlight.current) throw new Error("Wait for the current manuscript save, then retry.");
    const change = (current: AppState) => action === "place" ? placeWritingDraft(current, doc, id) : action === "drop" ? dropWritingParagraph(current, doc, id) : acceptWritingParagraph(current, doc, id, reviewedText ?? "");
    const next = change(latestState.current);
    latestState.current = next; setState(next); setCompileStale(true);
    if (action !== "approve") await savePaper();
    if (latestProjectId.current !== doc.project.id) return;
    const task = latestState.current.attentionTasks.find(t => t.id === id);
    if (action === "place" && task) returnToTask(task);
    else if (action === "approve") {
      const nextTask = latestState.current.attentionTasks.find(t => t.writing?.kind === "paragraph" && task?.writing?.kind === "paragraph" && t.writing.roundId === task.writing.roundId && t.status !== "reviewed");
      if (nextTask) returnToTask(nextTask);
    }
    setToast(action === "place" ? "Draft placed in the manuscript. Review every word before approving." : action === "approve" ? "This paragraph reviewed. Other changes and comments stay open." : "Draft set aside. Original wording and proposal kept in history.");
  }
  function showWritingTogether(roundId: string) {
    const doc = latestDocument.current;
    if (!doc) return;
    flushParagraph();
    const theme = writingRoundTheme(latestState.current.attentionTasks, doc, latestState.current.paragraphEdits, roundId);
    if (!theme) { setToast("No uniquely located passages. The saved proposals are kept."); return; }
    setState(current => ({ ...current, destination: "manuscript", lens: "themes", activeThemeId: theme.id,
      themeLenses: [...current.themeLenses.filter(t => t.id !== theme.id), theme], turbo: { ...current.turbo, enabled: false } }));
  }
  function addReviewComment(selected?: PendingSelection) {
    if (!document) return;
    try {
      const selection = selected ?? pendingSelection;
      const paragraph = paragraphs.find(p => p.id === (selection?.paragraphId ?? (state.turbo.enabled ? turboParagraph?.id : state.activeParagraphId))) ?? paragraphs.find(p => p.nodeId === activeNode.id);
      if (!paragraph) throw new Error("Choose a passage to comment on.");
      const text = selection ? "" : flushParagraph(paragraph.id);
      const chosen = selection?.spans ?? (selection ? [selection] : [{ paragraphId: paragraph.id, nodeId: paragraph.nodeId, start: 0, end: text.length, text }]);
      if (!chosen.length || chosen.length + latestState.current.attentionTasks.length > 2000) throw new Error("Too many linked passages. Choose a smaller selection or export older work.");
      const edits = { ...latestState.current.paragraphEdits };
      for (const span of chosen) edits[span.paragraphId] = flushParagraph(span.paragraphId);
      const tasks = chosen.map(span => makeReviewComment(document, edits, span));
      setState(current => tasks.reduce(queueAttentionTask, current));
      setPendingSelection(undefined); window.getSelection()?.removeAllRanges();
      openReview(tasks[0]);
      setToast(`${tasks.length === 1 ? "Passage" : `${tasks.length} passages`} queued. Use ✓ to resolve; notes stay in History.`);
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
  }
  function resolveComment(id: string, resolved: boolean) {
    const next = resolved ? nextCommentAfterResolve(reviewBlockId ? blockComments[reviewBlockId] ?? [] : latestState.current.attentionTasks, id, latestState.current.attentionTasks) : undefined;
    setState(current => resolveReviewComment(current, id, resolved));
    if (resolved && reviewOpen && reviewTaskId === id) {
      if (next) openReview(next, reviewBlockId);
      else setReviewTaskId(undefined);
    }
    setToast(resolved ? "Comment and replies resolved. The full thread remains in review history." : "Comment reopened. No request was sent.");
  }
  function replyToComment(id: string, body: string) {
    const parent = latestState.current.attentionTasks.find(t => t.id === id);
    if (!parent) return;
    try {
      const reply = makeReviewCommentReply(parent, body);
      setState(current => queueAttentionTask(current, reply));
      openReview(reply, reviewBlockId);
      setToast("Reply added. The original comment and its history are unchanged.");
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
  }
  async function addCommandComment(selection: Parameters<typeof makeCommandReviewComment>[1]) {
    const owner = latestDocument.current; if (!owner) return;
    const saved = await savePaper();
    if (latestDocument.current?.project.id !== owner.project.id || latestDocument.current.project.mainFile !== owner.project.mainFile) return;
    const task = makeCommandReviewComment(saved, selection);
    setState(current => queueAttentionTask(current, task)); openReview(task);
    setToast("Heading or command comment saved. Its original quote remains in History.");
  }
  async function jumpToComment(task: AttentionTask) {
    const owner = task.sourceSnapshot;
    const before = latestDocument.current;
    if (!before || task.review?.kind !== "comment" || !owner) return;
    if (owner.projectId !== before.project.id) {
      const item = queueTasks.find(item => item.projectId === owner.projectId && item.taskId === task.id);
      if (item) await useQueueItem(item, "jump");
      else setToast("This comment's project is not available in the queue. Its saved quote is kept.");
      return;
    }
    try {
      const opened = owner.rootFile !== before.project.mainFile ? await switchManuscript(owner.rootFile) : before;
      if (opened.project.id !== owner.projectId || opened.project.mainFile !== owner.rootFile) throw new Error("The manuscript changed while locating the comment. No location was guessed.");
      // Locate only after React has installed the owning document and view.
      setPendingCommentJump({ projectId: owner.projectId, rootFile: owner.rootFile, taskId: task.id });
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
  }
  const revealCommentPassage = useStableEvent((task: AttentionTask) => {
    const doc = latestDocument.current;
    if (!doc || task.review?.kind !== "comment") return;
    flushParagraph();
    const target = reviewCommentLocation(task, doc, latestState.current.paragraphEdits);
    if (!target) { setToast("The original passage could not be located safely. The saved quote and comment are kept."); return; }
    setReviewOpen(false); // Reveal the normal source/PDF layout, not the detail inspector.
    if (target.command) {
      const paragraphId = doc.nodes.find(n => n.id === target.nodeId)?.paragraphIds[0];
      setState(current => ({ ...locateSourcePassage(current, target.nodeId, paragraphId ?? "", manuscriptNodes), previewMode: "split" }));
      setJumpTarget({ nodeId: target.nodeId, command: target.command, flash: true, sequence: ++sourceSyncSequence.current });
      if (paragraphId) syncToPreview(paragraphId);
    } else { syncToSource(target.paragraphId); syncToPreview(target.paragraphId); }
    setPreambleEditing(false);
    setState(current => ({ ...current, detachedPreview: false }));
    setToast(target.changedBlock ? "Returned to the edited block. The original quote is preserved." : "Comment's passage shown in source and preview. No comment was resolved.");
  });
  useEffect(() => {
    if (!pendingCommentJump) return;
    setPendingCommentJump(undefined);
    if (document?.project.id !== pendingCommentJump.projectId || document.project.mainFile !== pendingCommentJump.rootFile) return;
    const task = latestState.current.attentionTasks.find(task => task.id === pendingCommentJump.taskId);
    if (task) revealCommentPassage(task);
  }, [pendingCommentJump, document?.project.id, document?.project.mainFile, revealCommentPassage]);
  function resolveProjectComments(ids: string[]) {
    const projectId = latestDocument.current?.project.id;
    if (!projectId) return;
    const localIds = queueTasks.filter(task => task.projectId === projectId && ids.includes(task.id)).map(task => task.taskId);
    setState(current => latestProjectId.current === projectId ? resolveQueuedReviewComments(current, localIds) : current);
    setToast("Queued comments resolved in this project. Quotes and replies remain in History; other tasks are unchanged.");
  }
  function toggleLater(selected?: PendingSelection) {
    const doc = latestDocument.current;
    if (!doc) return;
    try {
      const selection = selected ?? pendingSelection;
      if (!selection) throw new Error("Choose a block or highlight text to save for later.");
      const chosen = selection.spans ?? [selection];
      const edits = { ...latestState.current.paragraphEdits };
      for (const span of chosen) edits[span.paragraphId] = flushParagraph(span.paragraphId);
      const current = latestState.current;
      const removing = chosen.every(span => passageBookmark(current.attentionTasks, doc, edits, span));
      togglePassageBookmarks(current, doc, chosen, edits);
      setState(saved => togglePassageBookmarks(saved, doc, chosen, edits));
      setPendingSelection(undefined); window.getSelection()?.removeAllRanges();
      setToast(removing ? "Removed from queue. Bookmark kept in History; comments stay open." : `${chosen.length === 1 ? "Passage" : `${chosen.length} passages`} saved for later. Click the bookmark again to remove it.`);
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
  }
  async function saveReviewPacket(task: AttentionTask) {
    if (!document) return;
    const projectId = document.project.id; setSavingHandoff(true);
    setState(current => queueAttentionTask(current, task));
    try {
      const response = await fetch("/api/paperfocus/review/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, task }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Couldn't save review instructions.");
      if (latestProjectId.current !== projectId) return;
      setState(current => ({ ...current, attentionTasks: current.attentionTasks.map(t => t.id === task.id && t.review?.kind === "request" ? { ...t, ticket: result.ticket, handoffPath: result.ticket.promptPath, review: { ...t.review, instructionsPath: result.instructionsPath, webPath: result.webPath }, error: undefined } : t) }));
      setReviewTaskId(task.id);
      try { await navigator.clipboard.writeText(result.ticket.copyText); setToast("Review instructions saved and prompt copied. Nothing was sent; comments stay open."); }
      catch { setToast("Review instructions saved. Copy the prompt from the review panel."); }
    } catch (error) {
      if (latestProjectId.current === projectId) setState(current => ({ ...current, attentionTasks: current.attentionTasks.map(t => t.id === task.id ? { ...t, error: error instanceof Error ? error.message : String(error) } : t) }));
      throw error;
    } finally { setSavingHandoff(false); }
  }
  async function prepareReview(mode: "human" | "ai", scope: "paragraph" | "section" | "paper", route: "codex" | "chatgpt", instructions: string) {
    if (!document) return;
    const current = latestState.current;
    const paragraphId = current.turbo.enabled ? turboParagraph?.id : current.activeParagraphId ?? paragraphs.find(p => p.nodeId === current.activeNodeId)?.id;
    const edits = { ...current.paragraphEdits, ...(paragraphId ? { [paragraphId]: flushParagraph(paragraphId) } : {}) };
    const task = makeReviewRequest(reviewSnapshot(document, edits, scope, current.activeNodeId, paragraphId), current.attentionTasks, mode, instructions, route);
    openReview(task); await saveReviewPacket(task);
  }
  function useReviewTool(task: AttentionTask, rewrite: boolean) {
    if (!document || task.review?.kind !== "comment") return;
    const target = reviewCommentTarget(task, document, latestState.current.paragraphEdits);
    const source = target && paragraphText(latestState.current, target.paragraphId, paragraphs);
    if (!target || !source) { setToast("The saved passage changed. Keep the comment and select its current text before editing."); return; }
    const selection = { ...target, x: 0, y: 0 };
    setReviewOpen(false);
    if (rewrite) requestRewrite(selection, source);
    else {
      const entry = newNotebookEntry(document, latestState.current, selection);
      entry.question = task.review.body || "Help me review this passage.";
      entry.title = (task.review.body.trim() || "Review marked passage").slice(0, 70);
      entry.notes = `Review comment ${task.id}. This remains unresolved until I press Resolve.\n${task.review.body}`;
      setState(current => ({ ...current, destination: "manuscript", notebookEntries: [...current.notebookEntries, entry], manuscriptPromptId: entry.id, activeNotebookId: entry.id }));
      setManuscriptPromptOpen(true);
    }
  }

  function continueUsefulWork(pendingTask?: AttentionTask) {
    flushParagraph();
    const current = latestState.current;
    const result = document && nextWork(document, current, pendingTask);
    const next = result?.suggestion;
    if (!next) {
      setToast("No other unfinished work in this view. Choose a section; nothing was checked off.");
      return;
    }
    setManuscriptPromptOpen(false);
    if (next.kind === "notebook") patchState({ destination: "notebook", activeNotebookId: next.id });
    else if (current.turbo.enabled) { patchState({ destination: "manuscript" }); focusTurboParagraph(next.id); }
    else { navigateNode(next.nodeId!, next.id); setJumpTarget({ nodeId: next.nodeId!, paragraphId: next.id, sequence: Date.now() }); }
    setReplyTaskId(undefined); setActiveRewriteId(undefined); setActiveHandoff(undefined); setLatexAssistantOpen(false); setReferenceRequest(undefined);
    if (result!.fallback) patchState({ suggestions: { ...current.suggestions, relation: result!.relation } });
    setToast(`${result!.fallback ? `No remaining ${current.suggestions.relation} work; ` : ""}switched to ${next.title}. Waiting work stays linked.`);
  }

  async function dispatchRewrite(session: RewriteSession) {
    if (session.route === "rules") return;
    if (session.selectionSpans && !captureSelection({ ...session, text: session.sourceText, spans: session.selectionSpans, x: 0, y: 0 })) return;
    const existing = openTasks.find((task) => task.sessionId === session.id && task.status !== "failed");
    if (existing) { if (state.turbo.reviewingTaskId === existing.id) resumeTurboReply(); else nextUsefulPlace(); return; }
    setSavingHandoff(true);
    const projectId = document?.project.id;
    try {
      const context = [...new Set((session.selectionSpans ?? [{ paragraphId: session.paragraphId }]).map(span => paragraphText(state, span.paragraphId, paragraphs)))].join("\n\n");
      const sourceSnapshot = session.selectionSpans && document ? notebookTaskSource(newNotebookEntry(document, latestState.current, { ...session, text: session.sourceText, spans: session.selectionSpans, x: 0, y: 0 }), document) : undefined;
      if (session.route === "local") {
        const response = await fetch("/api/paperfocus/local-rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, sessionId: session.id, model: localModelForEffort(session.localModel, session.effortByRoute.local), effort: session.effortByRoute.local, instruction: session.instruction, sourceText: session.sourceText, context }) });
        const job = await response.json();
        if (!response.ok || !job.id) throw new Error(job.error ?? "Couldn't start the local helper.");
        if (latestProjectId.current !== projectId) return;
        const now = new Date().toISOString();
        const task: AttentionTask = { id: `attention-${crypto.randomUUID()}`, title: `Local rewrite · ${job.model}`, sessionId: session.id, sourceSnapshot, localJobId: job.id, turbo: state.turbo.enabled, nodeId: session.nodeId, paragraphId: session.paragraphId, route: "local", status: "working", createdAt: now, updatedAt: now };
        setState((current) => queueAttentionTask(current.attentionTasks.filter(item => item.sessionId === session.id && item.status === "failed").reduce((next, item) => archiveAttentionTask(next, item.id), current), task));
        setActiveRewriteId(undefined); continueUsefulWork(task);
        setToast("Working on this computer. Alternatives will appear here; the paper stays unchanged.");
        return;
      }
      const effort = effortLabels[session.route][session.effortByRoute[session.route]];
      const packet = ["Continue our wording pass; use the conversation history for unchanged context.", `Transfer: ${session.route === "codex" ? "shared folder" : "copy / paste"} · requested effort: ${effort}`, "Model and effort are chosen in your client; nothing is auto-submitted.", "", "## Task", session.instruction, "", "## Selected source", session.sourceText,
        "", "## Surrounding source (context only)", context, "", "## Project", `${document?.project.folder}/${document?.project.mainFile}`,
        "Inspect project files only as needed. Return alternative phrasings. Preserve LaTeX commands, math, labels, citations, and comments. Do not add tool-specific macros. This is a wording pass, not a proof review."].join("\n");
      const ticket = await exportHandoff(projectId!, packet + '\nFor machine-readable alternatives, optionally return {"candidates":["phrasing 1","phrasing 2"]}. Do not modify source files.', session.route);
      if (latestProjectId.current !== projectId) return;
      const node = manuscriptNodes.find((item) => item.id === session.nodeId);
      const now = new Date().toISOString();
      const task: AttentionTask = {
        id: `attention-${Date.now()}`,
        title: `${ticket.label} rewrite · ${node?.title ?? "passage"} · ¶${paragraphs.findIndex((paragraph) => paragraph.id === session.paragraphId) + 1}`,
        sessionId: session.id,
        sourceSnapshot,
        ticket,
        handoffPath: ticket.promptPath,
        packet,
        turbo: state.turbo.enabled,
        nodeId: session.nodeId,
        paragraphId: session.paragraphId,
        route: session.route,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      setState((current) => queueAttentionTask(current, task));
      try { await navigator.clipboard.writeText(ticket.copyText); } catch { /* Retained in Linked prompts. */ }
      setActiveRewriteId(undefined);
      continueUsefulWork(task);
      setToast("Prompt saved. Use any assistant; check its alternatives before replacing text.");
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
    finally { setSavingHandoff(false); }
  }

  function returnToTask(task: AttentionTask, preferNotebook = false) {
    if (task.review?.kind === "comment") { openReview(task); return Boolean(document && reviewCommentLocation(task, document, latestState.current.paragraphEdits)); }
    if (!task.writing) setWritingOpen(false);
    setReplyTaskId(undefined);
    flushParagraph();
    setReferenceRequest(undefined);
    setActiveHandoff(undefined); setActiveRewriteId(undefined); setLatexAssistantOpen(false); setPendingSelection(undefined);
    setManuscriptPromptOpen(false);
    if (task.notebookId) {
      const entry = latestState.current.notebookEntries.find(entry => entry.id === task.notebookId);
      if (!entry) { setReplyTaskId(task.id); return false; }
      if (!preferNotebook && document && notebookQueuePassage(task, document, latestState.current)) {
        setState(current => ({ ...current, activeNotebookId: entry.id, manuscriptPromptId: entry.id,
          notebookEntries: current.notebookEntries.map(saved => saved.id === entry.id && task.studyTurnId ? { ...saved, study: { ...studyState(saved), activeTurnId: task.studyTurnId } } : saved) }));
        returnFromNotebook(entry);
        return true;
      }
      setState((current) => {
        const opened = toggleNotebookConversation(current, task.notebookId!, true);
        return { ...opened, destination: "notebook", notebookEntries: opened.notebookEntries.map((entry) => entry.id === task.notebookId && task.studyTurnId ? { ...entry, study: { ...studyState(entry), activeTurnId: task.studyTurnId } } : entry) };
      });
      return true;
    }
    const target = document ? task.reminder?.kind === "section" ? sectionReminderTarget(task, document) : taskSourceTarget(task.sourceSnapshot, document, latestState.current.paragraphEdits, task) : undefined;
    const ancestors = new Set(target ? [target.nodeId] : []);
    let parent = manuscriptNodes.find((node) => node.id === target?.nodeId)?.parentId;
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = manuscriptNodes.find((node) => node.id === parent)?.parentId; }
    const paragraph = pass.find((item) => item.id === target?.paragraphId);
    if (target) setState((current) => ({ ...current, destination: "manuscript", lens: "paper", activeNodeId: target.nodeId, activeParagraphId: target.paragraphId, focusedNodeId: target.nodeId,
      blockWindow: current.blockWindow && target.paragraphId ? { ...current.blockWindow, paragraphId: target.paragraphId } : undefined,
      hiddenNodeIds: current.hiddenNodeIds.filter((id) => !ancestors.has(id)), collapsedNodeIds: current.collapsedNodeIds?.filter((id) => !ancestors.has(id)),
      turbo: { ...current.turbo, enabled: current.turbo.enabled && Boolean(paragraph), activeParagraphId: paragraph?.id ?? current.turbo.activeParagraphId,
        ...(current.turbo.enabled && paragraph && !task.review ? { reviewingTaskId: task.id, resumeParagraphId: current.turbo.resumeParagraphId ?? turboParagraph?.id, atEnd: false } : {}) } }));
    if (task.writing) { openWriting(task); if (!target) setToast("Writing proposal kept. Its source changed or is ambiguous; no location was guessed."); }
    else if (task.review) { openReview(task); if (!target) setToast("Comment kept. Its source changed or is ambiguous; no location was guessed."); }
    else if (task.sessionId) setActiveRewriteId(task.sessionId);
    else if (!task.reminder && (task.ticket || task.reply !== undefined || task.replyDraft !== undefined || task.status === "reviewed")) setReplyTaskId(task.id);
    else if (task.route === "chatgpt" || task.route === "codex") setActiveHandoff(task.route);
    if (target) setJumpTarget({ ...target, sequence: Date.now() });
    else if (task.reminder) setToast("Bookmark kept. Its source changed or is ambiguous; no location was guessed.");
    return Boolean(target);
  }

  function returnReadyResponse(id: string) {
    const current = latestState.current;
    const task = current.attentionTasks.find((task) => task.id === id && task.status === "ready");
    setReadyReturns((ids) => ids.filter((saved) => saved !== id));
    if (!task) return;
    setState((saved) => ({ ...saved, handoffResume: replyReturnBookmark(current, task) }));
    const returned = returnToTask(task);
    setToast(returned ? "Reply opened at its passage. Your previous view is saved." : "Reply opened without guessing the passage's new location. Your previous view is saved.");
  }
  function openReplyImport(task: AttentionTask) {
    if (task.writing) { openWriting(task); return; }
    if (task.review) { openReview(task); return; }
    setActiveHandoff(undefined); setActiveRewriteId(undefined); setLatexAssistantOpen(false); setReferenceRequest(undefined); setReplyTaskId(task.id);
  }
  function importPastedReply(taskId: string, reply: string, projectId?: string) {
    if (projectId !== latestProjectId.current || !reply.trim()) return false;
    const current = latestState.current;
    const next = receiveHandoffReply(current, taskId, reply);
    if (next === current) return false;
    setState((saved) => receiveHandoffReply(saved, taskId, reply));
    const imported = next.attentionTasks.find(task => task.id === taskId)?.status === "ready";
    if (imported) notifyPastedReply(taskId, projectId);
    return imported;
  }
  function notifyPastedReply(taskId: string, projectId?: string) {
    const task = latestState.current.attentionTasks.find((task) => task.id === taskId);
    if (projectId !== latestProjectId.current || !task || task.status === "reviewed") return;
    setReadyReturns((ids) => [...new Set([...ids, taskId])]);
  }
  useEffect(() => {
    const previous = previousTasks.current;
    if (previous.projectId === document?.project.id) {
      const arrivals = readyResponseArrivals(previous.tasks, state.attentionTasks);
      setReadyReturns((ids) => {
        const next = [...new Set([...ids, ...arrivals])].filter((id) => state.attentionTasks.some((task) => task.id === id && task.status === "ready"));
        return next.join(",") === ids.join(",") ? ids : next;
      });
    }
    previousTasks.current = { projectId: document?.project.id, tasks: state.attentionTasks };
  }, [document?.project.id, state.attentionTasks]);
  function resumeHandoffWork() {
    const bookmark = state.handoffResume;
    if (!bookmark) return;
    flushParagraph(); setReviewOpen(false); setReplyTaskId(undefined); setActiveHandoff(undefined); setActiveRewriteId(undefined); setLatexAssistantOpen(false); setReferenceRequest(undefined);
    const { studyTurnId, ...view } = bookmark;
    setState((current) => ({ ...current, ...view, turbo: { ...view.turbo, reviews: current.turbo.reviews, history: current.turbo.history }, handoffResume: undefined,
      notebookEntries: current.notebookEntries.map((entry) => entry.id === view.activeNotebookId && studyTurnId && entry.study ? { ...entry, study: { ...entry.study, activeTurnId: studyTurnId } } : entry) }));
    if (view.destination === "manuscript") setJumpTarget({ nodeId: view.activeNodeId, paragraphId: view.activeParagraphId, sequence: Date.now() });
  }

  function dismissTask(taskId: string) {
    const writingTask = latestState.current.attentionTasks.find(task => task.id === taskId && task.writing?.kind === "paragraph");
    if (writingTask) { returnToTask(writingTask); setToast("Review every word, then Approve this paragraph or set it aside."); return; }
    const writingRound = latestState.current.attentionTasks.find(task => task.id === taskId && task.writing?.kind === "request");
    if (writingRound && latestState.current.attentionTasks.some(t => t.writing?.kind === "paragraph" && t.writing.roundId === taskId && t.status !== "reviewed")) { openWriting(writingRound); setToast("Review or set aside each paragraph before finishing this round."); return; }
    if (state.attentionTasks.find(task => task.id === taskId)?.review?.kind === "comment") { setToast("Use Resolve to remove a comment from the queue."); return; }
    const local = state.attentionTasks.find((task) => task.id === taskId && task.localJobId && ["queued", "working"].includes(task.status));
    if (local) void fetch("/api/paperfocus/local-rewrite/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: local.localJobId, projectId: document?.project.id }) }).then(async (response) => { if (!response.ok) { const result = await response.json(); setToast(result.error ?? "The local request could not be cancelled."); } }).catch(() => setToast("Couldn't confirm cancellation. The request may still finish and save its reply."));
    if (state.turbo.reviewingTaskId === taskId) resumeTurboReply();
    setReadyReturns((ids) => ids.filter((id) => id !== taskId));
    setState((current) => {
      const next = archiveAttentionTask(current, taskId, Boolean(local));
      const task = current.attentionTasks.find(task => task.id === taskId);
      if (task?.reminder?.kind !== "section") return next;
      const target = document && sectionReminderTarget(task, document);
      return { ...next, progressByNode: target ? { ...current.progressByNode, [target.nodeId]: "done" } : current.progressByNode };
    });
    const reminder = state.attentionTasks.find(task => task.id === taskId)?.reminder;
    if (reminder) setToast(reminder.kind === "section" ? "Section marked done. Comments stay open; reminder kept in History." : "Passage finished. Bookmark kept in History; comments stay open.");
  }

  function reopenTask(id: string) {
    setState((current) => {
      const next = reopenAttentionTask(current, id), task = current.attentionTasks.find(task => task.id === id);
      if (task?.reminder?.kind !== "section") return next;
      const target = document && sectionReminderTarget(task, document);
      return { ...next, progressByNode: target ? { ...current.progressByNode, [target.nodeId]: "progress" } : current.progressByNode };
    });
    setToast(state.attentionTasks.find(task => task.id === id)?.reminder ? "Reminder back in the queue. No request was sent." : "Task reopened. Its reply is kept; no new request was sent.");
  }

  function finishExternalTask(id: string) {
    setState((current) => finishWithoutImport(current, id));
    setReadyReturns((ids) => ids.filter((item) => item !== id));
    setReplyTaskId((current) => current === id ? undefined : current);
    setToast("Finished in the other app. Prompt kept, no reply saved here, and paper progress unchanged.");
  }
  function finishQueueTask(id: string) {
    const task = latestState.current.attentionTasks.find(task => task.id === id);
    if (!task) return;
    if (canFinishWithoutImport(task)) finishExternalTask(id);
    else dismissTask(id);
  }
  function checkActiveItem() {
    if (currentQueueTask) {
      if (currentQueueTask.review?.kind === "comment") resolveComment(currentQueueTask.id, true);
      else finishQueueTask(currentQueueTask.id);
    } else if (currentCheckParagraph) {
      flushParagraph();
      setState(current => {
        const text = current.paragraphEdits[currentCheckParagraph.id] ?? currentCheckParagraph.text;
        if (reviewed(current.turbo, currentCheckParagraph.id, text)) {
          const reviews = { ...current.turbo.reviews }; delete reviews[currentCheckParagraph.id];
          return { ...current, turbo: { ...current.turbo, reviews } };
        }
        return { ...current, turbo: checkParagraph(current.turbo, currentCheckParagraph.id, text, "manual") };
      });
    }
  }

  const executeQueueAction = useStableEvent((taskId: string, action: QueueAction, resolved?: boolean) => {
    const task = latestState.current.attentionTasks.find(item => item.id === taskId);
    if (!task || !latestDocument.current) { setToast("That task is no longer available. No work was changed."); return; }
    setQueueCursor(projectQueueId(latestDocument.current.project.id, task.id));
    setQueueView(current => current.scope === "all" ? touchQueueView(current) : current);
    if (action === "jump") void jumpToComment(task);
    else if (action === "return") { if (task.status === "ready") returnReadyResponse(task.id); else returnToTask(task); }
    else if (action === "reply") { returnToTask(task, true); openReplyImport(task); }
    else if (action === "finish") finishQueueTask(task.id);
    else if (action === "reopen") reopenTask(task.id);
    else if (action === "comment") resolveComment(task.id, Boolean(resolved));
    else void copyTaskPrompt(task);
  });
  useEffect(() => {
    if (!pendingQueueAction) return;
    const clear = () => { setPendingQueueAction(undefined); setQueueNavigating(false); queueNavigationBusy.current = false; };
    if (document?.project.id !== pendingQueueAction.projectId) { clear(); return; }
    if (notebookStorage.error || workbenchStorage.error) {
      setToast(`Paper opened, but saved work could not be loaded. ${notebookStorage.error ?? workbenchStorage.error}`); clear(); return;
    }
    if (notebookStorage.ready && workbenchStorage.ready) {
      executeQueueAction(pendingQueueAction.taskId, pendingQueueAction.action, pendingQueueAction.resolved); clear(); return;
    }
    const timeout = window.setTimeout(() => { setToast("Paper opened, but its queue is still loading. No task was changed; try again when saved work is available."); clear(); }, 15_000);
    return () => window.clearTimeout(timeout);
  }, [pendingQueueAction, document?.project.id, notebookStorage.ready, notebookStorage.error, workbenchStorage.ready, workbenchStorage.error, executeQueueAction]);

  async function useQueueItem(item: AttentionTask, action: QueueAction, resolved?: boolean) {
    if (queueNavigationBusy.current) return;
    const target = queueTasks.find(task => task.id === item.id);
    const currentProjectId = latestDocument.current?.project.id;
    if (!target || !currentProjectId) return;
    if (target.projectId === currentProjectId) { executeQueueAction(target.taskId, action, resolved); return; }
    queueNavigationBusy.current = true; setQueueNavigating(true);
    try {
      flushParagraph();
      await prepareNavigation();
      // Let the owning stores finish their existing guarded autosaves before
      // changing project. Never transplant a foreign catalogue into AppState.
      const deadline = Date.now() + 10_000;
      while (true) {
        const saved = latestQueueStorage.current;
        if (latestProjectId.current !== currentProjectId || saved.projectId !== currentProjectId) throw new Error("The paper changed while opening the queue item. No task was changed.");
        const error = saved.workbench.error ?? saved.notebook.error;
        if (error) throw new Error(`Finish saving this paper before switching. ${error}`);
        if (saved.workbench.ready && saved.notebook.ready && !saved.workbench.pending && !saved.notebook.pending && !saved.workbench.saving && !saved.notebook.saving) break;
        if (Date.now() > deadline) throw new Error("This paper is still saving. Your work is kept; try the queue again in a moment.");
        await new Promise(resolve => window.setTimeout(resolve, 50));
      }
      const next = await loadDocument(`/api/paperfocus/document?projectId=${encodeURIComponent(target.projectId)}`);
      if (latestProjectId.current !== currentProjectId) throw new Error("The paper changed while opening the queue item. No task was changed.");
      activateDocument(next);
      setPendingQueueAction({ projectId: target.projectId, taskId: target.taskId, action, resolved });
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
      queueNavigationBusy.current = false; setQueueNavigating(false);
    }
  }
  function queueActionById(id: string, action: QueueAction, resolved?: boolean) {
    const task = queueTasks.find(item => item.id === id);
    if (task) void useQueueItem(task, action, resolved);
  }
  function moveQueueItem(id: string, targetId: string, after?: boolean) {
    if (queueView.scope === "all") setQueueView(current => moveProjectQueue(current, queueTasks, id, targetId, after));
    else {
      const item = queueTasks.find(task => task.id === id), target = queueTasks.find(task => task.id === targetId);
      if (item && target) setState(current => moveAttentionTask(current, item.taskId, target.taskId, after));
    }
  }

  function finishReplyReview(task: AttentionTask) {
    dismissTask(task.id); setReplyTaskId(undefined);
    if (state.handoffResume) resumeHandoffWork(); else nextUsefulPlace();
  }

  function followUpReply(task: AttentionTask) {
    const route = task.ticket?.transport === "files" ? "codex" : "chatgpt";
    returnToTask(task);
    setState((current) => { const key = `${route}:${current.activeNodeId}`; return { ...current, handoffDrafts: { ...current.handoffDrafts,
      [key]: { ...defaultHandoff(route, true), label: task.ticket?.label, instruction: "", scope: "auto", contextMode: "continuation", previousTaskId: task.id } } }; });
    setReplyTaskId(undefined); setActiveHandoff(route);
  }

  function openPassageTool(kind: "chatgpt" | "codex" | "latex") {
    flushParagraph(); setReplyTaskId(undefined); setReferenceRequest(undefined); setActiveRewriteId(undefined); setPendingSelection(undefined);
    setActiveHandoff(kind === "latex" ? undefined : kind); setLatexAssistantOpen(kind === "latex");
  }

  function showLatexLayout(previewMode: AppState["previewMode"]) {
    flushParagraph(); setLatexMenuOpen(false); setLatexAssistantOpen(false);
    patchState({ previewMode, ...(previewMode !== "hidden" ? { detachedPreview: false } : {}), ...(previewMode !== "full" ? { displayMode: "source" } : {}) });
  }

  function rephraseCurrentParagraph() {
    if (state.turbo.enabled) { polishTurboParagraph(); return; }
    const paragraph = paragraphs.find((item) => item.id === handoffParagraphId);
    if (!paragraph) return;
    const text = flushParagraph(paragraph.id);
    setReplyTaskId(undefined); setReferenceRequest(undefined); setActiveHandoff(undefined); setLatexAssistantOpen(false);
    requestRewrite({ paragraphId: paragraph.id, nodeId: paragraph.nodeId, start: 0, end: text.length, text }, text);
  }

  async function copyTaskPrompt(task: AttentionTask) {
    if (!task.packet) { setToast(`Saved prompt: ${task.handoffPath ?? "Open the task to prepare its prompt."}`); return; }
    let ticket = task.ticket;
    const projectId = document?.project.id;
    if (ticket?.transport === "files" && projectId) {
      try {
        ticket = await fetchHandoffTicket(projectId, ticket.id);
        if (latestProjectId.current !== projectId) return;
        const refreshed = ticket;
        setState(current => refreshHandoffTicket(current, task.id, refreshed));
      } catch (error) { setToast(error instanceof Error ? error.message : "Couldn't read this request. Nothing was copied."); return; }
    }
    try { await navigator.clipboard.writeText(ticket?.copyText ?? task.packet); setToast(ticket?.transport === "files" ? "Instructions copied. Replies return through this task's shared file." : "Prompt copied. Use any assistant; paste its reply here if needed."); }
    catch { setToast("Clipboard unavailable. Open Linked prompts → Saved prompt to copy it."); }
  }

  function dispatchHandoff(ticket: HandoffTicket, effort: string, packet: string, sourceSnapshot?: TaskSourceSnapshot) {
    if (!activeHandoff) return;
    if (latestProjectId.current !== document?.project.id) return;
    if (sourceSnapshot && sourceSnapshot.projectId !== latestProjectId.current) return;
    const now = new Date().toISOString();
    const previousTaskId = state.handoffDrafts?.[`${activeHandoff}:${activeNode.id}`]?.previousTaskId;
    const task: AttentionTask = {
      previousTaskId,
      id: `attention-${Date.now()}`,
      title: `${ticket.label} · ${sourceSnapshot?.nodeTitle ?? activeNode.title}${previousTaskId ? ` · Follow-up ${attentionTurnNumber(state.attentionTasks, previousTaskId)}` : ""} · ${effort}`,
      ticket,
      handoffPath: ticket.promptPath,
      packet,
      sourceSnapshot,
      nodeId: sourceSnapshot?.nodeId ?? activeNode.id,
      paragraphId: sourceSnapshot?.focusParagraphId ?? handoffParagraphId,
      turbo: state.turbo.enabled,
      route: activeHandoff,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    setState((current) => queueAttentionTask(current, task));
    setActiveHandoff(undefined);
    continueUsefulWork(task);
  }

  function syncToSource(paragraphId: string) {
    const paragraph = document?.paragraphs.find(item => item.id === paragraphId);
    if (!paragraph) return;
    forwardSyncSequence.current++; setForwardSyncRequest(undefined);
    flushParagraph();
    setState(current => ({ ...locateSourcePassage(current, paragraph.nodeId, paragraphId, manuscriptNodes), previewMode: "split" }));
    setJumpTarget({ nodeId: paragraph.nodeId, paragraphId, flash: true, sequence: ++sourceSyncSequence.current });
  }

  async function syncPdf(direction: "forward" | "inverse", position: { paragraphId?: string; page?: number; x?: number; y?: number }, build = compileResult) {
    const document = latestDocument.current;
    const compileResult = build;
    if (!document || !compileResult?.success) return;
    if (Object.keys(latestState.current.paragraphEdits).length || compileResult.sourceRevision !== document.revision || compileResult.stale) {
      setToast("Compile this view again to link the current source and PDF. Rendered text links work immediately."); return;
    }
    const projectId = document.project.id;
    const sequence = ++sourceSyncSequence.current;
    try {
      const response = await fetch("/api/paperfocus/source-sync", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, revision: document.revision, mode: compileResult.mode, artifactKey: compileResult.artifactKey, direction, ...position }) });
      const target = await response.json();
      if (!response.ok) throw new Error(target.error ?? "This passage has no source link.");
      if (latestProjectId.current !== projectId || sequence !== sourceSyncSequence.current) return;
      const currentSource = latestDocument.current;
      if (!currentSource || currentSource.project.mainFile !== document.project.mainFile || currentSource.revision !== document.revision) return;
      if (direction === "inverse") syncToSource(target.paragraphId);
      else {
        if (compileResult.originalPages && !compileResult.originalPages.includes(target.page)) setCompileResult(current => current ? { ...current, originalPages: undefined, viewNote: "Opened the full PDF to show this passage outside the selected pages." } : current);
        setPreviewJumpTarget({ ...target, sequence });
      }
    } catch (error) { if (latestProjectId.current === projectId && sequence === sourceSyncSequence.current) setToast(error instanceof Error ? error.message : String(error)); }
  }

  function syncToPreview(paragraphId: string) {
    const doc = latestDocument.current; if (!doc) return;
    setState(current => ({ ...current, previewMode: "split" }));
    if (previewFormat === "pdf") setForwardSyncRequest({ identity: manuscriptBuildIdentity(doc), paragraphId, sequence: ++forwardSyncSequence.current });
    else setPreviewJumpTarget({ paragraphId, sequence: ++sourceSyncSequence.current });
  }

  async function compileLatex(mode: CompileMode, originalPages = false, automatic = false) {
    const requestedDocument = latestDocument.current;
    if (!requestedDocument || manuscriptNavigationBusy.current || compileInFlight.current) return;
    compileInFlight.current = true;
    sourceSyncSequence.current++; setPreviewJumpTarget(undefined);
    switchDestination("manuscript");
    setCompiling(true);
    setCompileMenuOpen(false);
    setState((current) => ({
      ...current,
      previewMode: current.previewMode === "hidden" && !current.detachedPreview ? "split" : current.previewMode,
    }));
    let requestedScope = renderedCompileScope.current;
    try {
      const saved = await savePaper();
      if (manuscriptBuildIdentity(saved) !== manuscriptBuildIdentity(requestedDocument)) return;
      const savedView = latestState.current;
      requestedScope = renderedCompileScope.current;
      // Even cache hits follow savePaper: command/heading drafts are not all
      // represented in paragraphEdits, and cannot safely bypass its flushes.
      if (!latestDocument.current || manuscriptBuildIdentity(latestDocument.current) !== manuscriptBuildIdentity(saved)) return;
      const cached = automatic && mode === "focus" && !originalPages ? manuscriptBuildCache.current.read(saved, requestedScope) : undefined;
      if (cached) { setCompileResult(cached); setCompileStale(false); return cached; }
      const response = await fetch("/api/paperfocus/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: saved.project.id,
          revision: saved.revision,
          mode,
          originalPages,
          focusNodeId: originalPages && !savedView.blockWindow && !savedView.turbo.enabled ? savedView.activeNodeId : savedView.turbo.enabled || savedView.blockWindow && savedView.lens !== "themes" ? undefined : savedView.focusedNodeId,
          paragraphIds: savedView.turbo.enabled ? turboWindows(turboPass(saved.paragraphs, saved.nodes, savedView.hiddenNodeIds, savedView.turbo.includeTechnical), savedView.turbo.activeParagraphId, savedView.turbo.context).preview.paragraphs.map(p => p.id)
            : savedView.blockWindow && !savedView.turbo.enabled && savedView.lens !== "themes" ? manuscriptBlockWindow(saved.nodes, saved.paragraphs, savedView.lens, savedView.hiddenNodeIds, savedView.blockWindow, savedView.activeParagraphId, savedView.activeNodeId).paragraphs.filter(p => !p.emptySource).map(p => p.id) : undefined,
          lens: savedView.lens,
          hiddenNodeIds: savedView.hiddenNodeIds,
        }),
      });
      const result = (await response.json()) as CompileResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Compile request failed.");
      const current = latestDocument.current;
      if (!current || manuscriptBuildIdentity(current) !== manuscriptBuildIdentity(saved)) return;
      manuscriptBuildCache.current.remember(saved, result);
      if (mode === "focus" && !originalPages && requestedScope !== renderedCompileScope.current) return;
      setCompileResult(result);
      if (!result.success || result.diagnostics?.some((item) => item.severity === "error")) {
        setLatexAssistantOpen(true);
      }
      if (result.success) {
        setPreviewFormat("pdf");
        announceSaved(saved.project.id, "compile");
        setCompileStale(Boolean(Object.keys(latestState.current.paragraphEdits).length));
        if (mode === "full") setLastFullCompile(result);
        if (!automatic) setToast(
          `${originalPages ? "Original pages" : mode === "full" ? "Full document" : "Focused view"} ${result.cacheHit ? "reused from cache" : "compiled"} in ${(result.durationMs / 1000).toFixed(1)}s.`,
        );
      } else {
        setToast("LaTeX found an error. Diagnostics are open in the preview.");
      }
      return result;
    } catch (error) {
      if (!latestDocument.current || manuscriptBuildIdentity(latestDocument.current) !== manuscriptBuildIdentity(requestedDocument)) return;
      if (mode === "focus" && !originalPages && requestedScope !== renderedCompileScope.current) return;
      // No TeX run took place: keep the previous PDF/build record instead of
      // presenting a file conflict as a LaTeX diagnostic in the preview.
      if (error instanceof SourceSaveConflict) { setToast(error.message); return; }
      const failed: CompileResult = {
        mode,
        success: false,
        durationMs: 0,
        compiledAt: new Date().toISOString(),
        log: error instanceof Error ? error.message : String(error),
      };
      setCompileResult(failed);
      setToast(failed.log ?? "The local compile service could not complete the build.");
    } finally {
      compileInFlight.current = false;
      setCompiling(false);
    }
  }

  async function dispatchLatexAssistant(
    route: "chatgpt" | "codex",
    effort: string,
    packet: string,
  ) {
    const projectId = document?.project.id;
    if (!projectId) throw new Error("Choose a paper first.");
    const ticket = await exportHandoff(projectId, packet, route);
    if (latestProjectId.current !== projectId) return;
    const now = new Date().toISOString();
    const task: AttentionTask = {
      id: `attention-${Date.now()}`,
      title: `${ticket.label} · LaTeX repair · ${effort}`,
      ticket,
      handoffPath: ticket.promptPath,
      packet,
      nodeId: activeNode.id,
      route,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    setState((current) => queueAttentionTask(current, task));
    try { await navigator.clipboard.writeText(ticket.copyText); } catch { /* Retained in Linked prompts. */ }
    setLatexAssistantOpen(false);
    continueUsefulWork(task);
    setToast("LaTeX help prompt saved for your other app.");
  }

  const foldOutline = useStableEvent(() => patchState({ collapsedNodeIds: manuscriptNodes.filter((node) => manuscriptNodes.some((child) => child.parentId === node.id)).map((node) => node.id) }));
  const toggleOutline = useStableEvent((nodeId: string) => setState((current) => ({ ...current, collapsedNodeIds: (current.collapsedNodeIds ?? []).includes(nodeId) ? (current.collapsedNodeIds ?? []).filter((id) => id !== nodeId) : [...(current.collapsedNodeIds ?? []), nodeId] })));
  const selectOutline = useStableEvent((nodeId: string) => {
    if(preambleEditing){void savePaper().then(()=>{setPreambleEditing(false);navigateNode(nodeId);}).catch(reason=>setToast((reason as Error).message));return;}
    if (state.turbo.enabled) navigateNode(nodeId); else { const paragraphId = paragraphs.find((paragraph) => paragraph.nodeId === nodeId)?.id; patchState({ activeNodeId: nodeId, activeParagraphId: paragraphId, ...(state.focusedNodeId && !state.blockWindow ? { focusedNodeId: nodeId } : {}), ...(state.blockWindow ? { focusedNodeId: undefined, blockWindow: { ...state.blockWindow, paragraphId } } : {}) }); setJumpTarget({ nodeId, paragraphId, sequence: Date.now() }); }
    setMobileOutlineOpen(false);
  });
  const focusOutline = useStableEvent(async (nodeId?: string) => {
    try {
      if (preambleEditing) { await savePaper(); setPreambleEditing(false); } else flushParagraph();
      const currentParagraphs = latestDocument.current?.paragraphs ?? paragraphs;
      patchState({ focusedNodeId: nodeId, blockWindow: undefined, turbo: { ...latestState.current.turbo, enabled: false }, ...(nodeId ? { activeNodeId: nodeId, activeParagraphId: currentParagraphs.find((paragraph) => paragraph.nodeId === nodeId)?.id } : {}) });
      if (latestDocument.current) { setScopeCompileRequest(manuscriptBuildIdentity(latestDocument.current)); setCompileStale(true); }
    } catch (reason) { setToast((reason as Error).message); }
  });
  const hideOutline = useStableEvent((nodeId: string) => setState((current) => ({ ...current, hiddenNodeIds: current.hiddenNodeIds.includes(nodeId) ? current.hiddenNodeIds.filter((id) => id !== nodeId) : [...current.hiddenNodeIds, nodeId] })));
  const progressOutline = useStableEvent((nodeId: string) => {
    if (!document) return;
    try {
      const next = cycleQueuedProgress(latestState.current, document, nodeId);
      setState(current => cycleQueuedProgress(current, document, nodeId));
      setToast(next.progressByNode[nodeId] === "done" ? "Marked done. Section reminder finished; comments stay open." : "Section reminder queued. Your notes and other tasks stay unchanged.");
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
  });
  const selectThemeOutline = useStableEvent((themeId: string) => patchState({ activeThemeId: themeId }));

  return (
    <div className="app-shell" data-interface-size={chromePreferences.interfaceSize} data-compact-aw-links={chromePreferences.compactAwLinks}>
      <div className={`chrome-frame${chromePreferences.autoHideTopbar ? " auto-hide" : ""}${chromeRevealed ? " is-revealed" : ""}`} onPointerDown={() => { chromePointerNavigation.current = true; }} onKeyDown={() => { chromePointerNavigation.current = false; }} onPointerLeave={event => delayChromeHide(event.currentTarget)}>
      {chromePreferences.autoHideTopbar && <><div className="chrome-hover-strip" onPointerEnter={delayChromeReveal} onPointerLeave={()=>chromeHover.current?.cancel()}><button className="chrome-reveal" type="button" aria-label="Keep top bar visible" title="Pause here to reveal · click to keep the top bar visible" onClick={() => setChromePreferences((current) => ({ ...current, autoHideTopbar: false }))}><span className="chrome-band-brand" aria-hidden="true">{appInitials}</span><ChevronDown size={10} /><span className="chrome-band-hint">Workspace</span></button></div><div className="chrome-neutral-gap" aria-hidden="true" onPointerEnter={event => { if (event.currentTarget.parentElement) delayChromeHide(event.currentTarget.parentElement); }} /></>}
      <header className="topbar" onPointerEnter={() => { chromeHover.current?.cancel();clearTimeout(chromeHideTimer.current); setChromeRevealed(true); }}>
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">{appInitials}</div>
          <div>
            <div className="brand-line">
              <strong>{appName}</strong>
              <span className="prototype-pill">preview</span>
            </div>
          </div>
        </div>

        <nav className="destination-tabs" aria-label="Project workspace">
          <button className={state.destination === "manuscript" ? "is-active" : ""} onClick={() => switchDestination("manuscript")}><FileText size={15} /> Manuscript</button>
          <button className={state.destination === "notebook" ? "is-active" : ""} onClick={() => switchDestination("notebook")}><BookOpen size={15} /> Notebook</button>
        </nav>

        <div className="topbar-actions">
          {document && <ManuscriptSwitcher key={`${document.project.id}:${document.project.mainFile}`} document={document} disabled={manuscriptBusy || compiling || savingPaper || savingHandoff || sourceRefreshing || queueNavigating || repositoryOpen || environmentBusy}
            onSelect={switchManuscript} onVersion={newVersion} onPurpose={changeManuscriptPurpose} onCreate={(file, title, kind) => switchManuscript(file, { title, kind })}
            section={document.nodes.find(node => node.id === chooseManuscriptScope(state, "section", document.nodes).focusedNodeId)} onSectionFile={saveSectionFile} />}
          <ToolbarDetails className="appearance-settings" summary={<><SlidersHorizontal size={14} /><span className="sr-only">Appearance settings</span></>}>
            <div className="appearance-settings-panel">
              <strong>Appearance</strong>
              <p>Text and controls follow the theme. PDFs stay white by default.</p>
              <details><summary>Advanced</summary>
                <label><input type="checkbox" checked={chromePreferences.hideTopbarByDefault} onChange={event => setChromePreferences(current => ({ ...current, hideTopbarByDefault: event.target.checked }))} /> Hide top bar by default</label>
                <label>Interface size<select aria-label="Interface size" value={chromePreferences.interfaceSize} onChange={event => setChromePreferences(current => ({ ...current, interfaceSize: event.target.value as typeof current.interfaceSize }))}><option value="auto">Automatic · larger on monitors</option><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="large">Large</option></select></label>
                <small>Sizes controls and menus, not the manuscript or PDF. Text panes keep their own zoom.</small>
                <label>Editor text size<input aria-label="Editor text size" type="range" min="50" max="250" step="5" value={Math.round(editorTextZoom * 100)} onChange={event => setEditorTextZoom(Number(event.target.value) / 100)} /><output>{Math.round(editorTextZoom * 100)}%</output><button type="button" onClick={() => setEditorTextZoom(1)}>Reset</button></label>
                <small>Also use Ctrl/⌘ + wheel or +/− inside the editor. Wraps visually; saved LaTeX line breaks are unchanged.</small>
                <label><input type="checkbox" checked={chromePreferences.compactAwLinks} onChange={event => setChromePreferences(current => ({ ...current, compactAwLinks: event.target.checked }))} /> Fold long references</label>
                <small>Click … to expand the exact source; leave the passage to fold again. Full-file source stays literal.</small>
                <label><input type="checkbox" aria-label="Explicit source blocks" checked={state.sourcePresentation==="blocks"} disabled={!document || savingPaper} onChange={()=>{void toggleSourceBlocks();}} /> Show source boxes</label>
                <small>Off by default. Block tools, focus views and linked proofs remain available either way.</small>
                <details className="second-screen-settings"><summary>Second screen & windows</summary>
                  <small>Open another view, then drag it to your monitor. Locations and zoom stay independent; saved notes and queue work are shared.</small>
                  <div className="window-actions">
                    <button type="button" disabled={!document} aria-label="Open paper window" onClick={() => openWorkspaceWindow("paper")}>Paper</button>
                    <button type="button" disabled={!document} aria-label="Open notebook window" onClick={() => openWorkspaceWindow("notebook")}>Notebook</button>
                    <button type="button" disabled={!document} aria-label="Move preview to new window" onClick={() => openWorkspaceWindow("preview")}>Move preview</button>
                  </div>
                  {windowFallbackUrl && <a href={windowFallbackUrl} target="_blank" rel="noopener noreferrer">Open as tab</a>}
                  <small>Each window keeps its own draft. Conflicting edits are kept for review, never silently overwritten.</small>
                  <details onToggle={event => { if (event.currentTarget.open && document) {
                    try { setWindowRecoveries(listWindowRecoveries(sharedRecoveryStorage(), `paperfocus.prototype.v1.${document.project.id}`, workspaceWindowId)); } catch { setWindowRecoveries([]); }
                  } }}><summary>Window recovery</summary>
                    <small>Open a kept draft separately. An older version stays paused for review.</small>
                    {windowRecoveries.length ? windowRecoveries.map(copy => <div className="window-actions" key={copy.id}><button type="button" onClick={() => openWorkspaceWindow("paper", copy.id)}>Open {copy.draftCount} draft{copy.draftCount === 1 ? "" : "s"} · {copy.savedAt ? new Date(copy.savedAt).toLocaleString() : "earlier window"}</button></div>) : <small>No other window drafts for this paper.</small>}
                  </details>
                </details>
                <label><input type="checkbox" checked={chromePreferences.automaticCompilation} onChange={event => setChromePreferences(current => ({ ...current, automaticCompilation: event.target.checked }))} /> Automatic compilation</label>
                <small>Updates the PDF after a pause. Block window waits for 4 seconds without scrolling or typing. Rendered text stays compile-free.</small>
                <label><input type="checkbox" checked={chromePreferences.darkPdf} onChange={event => setChromePreferences(current => ({ ...current, darkPdf: event.target.checked }))} /> Dark PDF display</label>
                <small>Inverts the preview only, including figures. Saved PDFs and printing are unchanged.</small>
              </details>
            </div>
          </ToolbarDetails>
          <WorkspaceFolders projectId={document?.project.id} onSaveDrafts={async () => {
            const owner = latestDocument.current?.project.id; if (!owner) throw new Error("Open a project first.");
            flushParagraph(); await savePaper(); await flushProjectExperimentDrafts(owner); await notebookStorage.flush();
            if (latestDocument.current?.project.id !== owner) throw new Error("The project changed during saving; choose the transfer again.");
          }} />
          <button className="chrome-hide-button" type="button" aria-label={chromePreferences.autoHideTopbar ? "Keep top bar visible" : "Auto-hide top bar"} title={chromePreferences.autoHideTopbar ? "Keep top bar visible" : "Auto-hide top bar · hover to reveal"} onClick={() => {
            setChromePreferences((current) => ({ ...current, autoHideTopbar: !current.autoHideTopbar }));
            setCompileMenuOpen(false);
            outlineToggleRef.current?.focus();
          }}>{chromePreferences.autoHideTopbar ? <Pin size={14} /> : <ChevronUp size={14} />}</button>
        </div>
      </header>
      </div>
      {document && initialWindowRequest?.projectId === document.project.id && initialWindowRequest.panel === "paper" && !linkedSourceOpened && !linkedSourceNoticeDismissed && (initialWindowRequest.rootFile !== document.project.mainFile || initialWindowRequest.revision !== document.revision) && <div className="workspace-link-notice" role="status">
        <span>{initialWindowRequest.rootFile === document.project.mainFile
          ? "This passage link predates recent edits. You’re viewing the current manuscript; the old passage location was not used."
          : `This link points to ${initialWindowRequest.rootFile || "another manuscript"}, not the manuscript currently open. Its passage location was not used.`}</span>
        {initialWindowRequest.rootFile !== document.project.mainFile && document.rootFiles.includes(initialWindowRequest.rootFile) && <button disabled={manuscriptBusy || compiling || savingPaper} onClick={() => { void openLinkedSource(); }}>Open linked manuscript</button>}
        <button aria-label="Dismiss passage link notice" title="Dismiss notice" onClick={() => setLinkedSourceNoticeDismissed(true)}><X size={13} /></button>
      </div>}
      {document && initialWindowRequest?.panel === "notebook" && workspaceBackLink(location.href, initialWindowRequest.backLink, document.project.id) && <div className="workspace-link-notice"><a href={workspaceBackLink(location.href, initialWindowRequest.backLink, document.project.id)} target="_blank" rel="noopener noreferrer">Return to manuscript passage</a><small>This link's source location; saved source only.</small></div>}
      {document && sectionUndo?.projectId === document.project.id && sectionUndo.mainFile === document.project.mainFile && <div className="workspace-link-notice" role="status">
        <span>Section/file change saved.{document.revision !== sectionUndo.revision ? " Later source edits prevent automatic undo; the recovery copy is kept." : ""}</span>
        <button disabled={manuscriptBusy || compiling || savingPaper || document.revision !== sectionUndo.revision || Object.keys(state.paragraphEdits).length > 0} onClick={() => { void undoSectionChange(); }}>Undo section/file change</button>
        <button aria-label="Dismiss section undo notice" onClick={() => setSectionUndo(undefined)}><X size={13} /></button>
      </div>}

      {projectError && <div className="project-load-error">{projectError}<button onClick={() => setRepositoryOpen(true)}>Open another paper</button></div>}
      {(browserRecoveryError || largerRecovery.error) && <div className="project-load-error" role="status">{browserRecoveryError || largerRecovery.error}<button onClick={() => { void flushLargerRecovery().catch(() => undefined); setRecoveryRetry(value => value + 1); }}>Retry browser recovery</button></div>}
      {autoSaveError && !saveNoticeCollapsed && <div className="paper-autosave-error" role="alert">
        <div><strong>Save paused</strong><span>{autoSaveError} Your draft is kept in this browser.</span></div>
        <div className="save-warning-actions"><button onClick={() => { setSaveNoticeCollapsed(true); void checkSourceFiles(); }}>Review source changes</button><button onClick={() => { setAutoSaveError(undefined); void savePaper().catch((error) => setAutoSaveError(error.message)); }}>Retry save</button><button aria-label="Minimize save warning" title="Minimize · saving remains paused" onClick={() => setSaveNoticeCollapsed(true)}><ChevronUp size={14} /></button></div>
      </div>}
      {sourcePanelOpen && document && <SourceRefresh before={document} incoming={incomingSource} plan={sourcePlan} copies={sourceCopies} busy={sourceRefreshing} error={sourceRefreshError}
        onClose={() => setSourcePanelOpen(false)} onCheck={() => void checkSourceFiles()} onRefresh={() => void refreshSourceFiles()}
        onCopy={(text) => void navigator.clipboard.writeText(text).then(() => setToast("Draft text copied. Paste into the passage you choose.")).catch(() => setToast("Clipboard unavailable. Select and copy the draft text manually."))} />}

      <div className={`workspace ${!chromePreferences.sidebarPinned ? "compact-sidebar" : ""} ${inspectorOpen ? "has-inspector" : ""} ${referenceRequest ? "has-reference-reader" : ""} ${(state.destination === "notebook" ? !state.notebookIndexVisible : state.outlineCollapsed) ? "no-outline" : ""}`}>
        {mobileOutlineOpen && (
          <button
            className="mobile-outline-backdrop"
            aria-label="Close contents"
            onClick={() => setMobileOutlineOpen(false)}
            type="button"
          />
        )}
        <aside className={`outline-pane ${mobileOutlineOpen ? "is-mobile-open" : ""}`} data-sidebar-content={state.destination} data-hover-revealed={sidebarRevealed ? "true" : undefined} onPointerEnter={()=>{if(!sidebarRevealed)sidebarHover.current?.enter();}} onClickCapture={()=>{sidebarHover.current?.cancel();setSidebarRevealed(true);}} onPointerDown={event => {
          sidebarPointerNavigation.current = true;
          // Don't relocate a compact-grid button between mouse-down and click.
          // Click reveals it afterward; Tab/search focus still reveals immediately.
          if(event.pointerType==="mouse" && event.button===0 && event.target instanceof Element && event.target.closest("button"))event.preventDefault();
        }} onKeyDown={() => { sidebarPointerNavigation.current = false; }} onPointerLeave={event => {
          sidebarHover.current?.cancel();setSidebarRevealed(false);
          const focused = window.document.activeElement;
          // Pointer navigation shouldn't leave an idle sidebar expanded forever.
          // Keep deliberate keyboard focus and active search fields expanded.
          if (sidebarPointerNavigation.current && focused instanceof HTMLButtonElement && event.currentTarget.contains(focused)) focused.blur();
        }}>
        {state.destination === "manuscript" ? <>
          <nav className="lens-tabs outline-lenses" aria-label="Manuscript view">{lenses.map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} title={label} className={state.lens === id ? "lens-tab is-active" : "lens-tab"} onClick={() => {void changeLens(id);}}><Icon size={14} /><span>{label}</span></button>)}<button className={`lens-tab turbo-toggle ${state.turbo.enabled ? "is-active" : ""}`} aria-label="Turbo" title="Turbo" aria-pressed={state.turbo.enabled} disabled={!document || compiling || savingHandoff} onClick={toggleTurbo}><Zap size={14} /><span>Turbo</span></button></nav>
          <div className="search-box">
            <button className="outline-search-trigger" aria-label="Find text in this paper" title="Search paper · Ctrl/⌘ K" onClick={() => searchRef.current?.focus()}><Search size={15} /></button>
            <input
              ref={searchRef}
              aria-label="Search paper"
              placeholder="Search paper"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <kbd title="Ctrl+K on Windows/Linux, ⌘K on Mac">Ctrl/⌘ K</kbd>
          </div>
          {searchQuery.trim().length >= 2 && (
            <div className="search-results">
              <div className="search-results-caption">
                <span>Matches</span><small>{searchResults.length}</small>
              </div>
              {searchResults.length > 0 ? searchResults.map(({ paragraph, node, text }) => (
                <button
                  key={paragraph.id}
                  onClick={() => {
                    navigateNode(paragraph.nodeId, paragraph.id);
                    setSearchQuery("");
                    setMobileOutlineOpen(false);
                  }}
                  type="button"
                >
                  <strong>{node?.title ?? paragraph.nodeId}</strong>
                  <span>{text}</span>
                </button>
              )) : <p>No passage contains “{searchQuery.trim()}”.</p>}
            </div>
          )}
          <Outline
            onPreamble={()=>{void openPlainSource(document?.project.mainFile,true);}}
            lens={state.lens}
            nodes={manuscriptNodes}
            activeNodeId={state.activeNodeId}
            focusedNodeId={state.focusedNodeId}
            hiddenNodeIds={state.hiddenNodeIds}
            collapsedNodeIds={state.collapsedNodeIds ?? []}
            onFold={foldOutline}
            onToggleCollapsed={toggleOutline}
            progressByNode={state.progressByNode}
            rewriteSessions={state.rewriteSessions}
            themes={state.themeLenses}
            activeThemeId={state.activeThemeId}
            onSelectNode={selectOutline} onFocusNode={focusOutline} onToggleHidden={hideOutline} onCycleProgress={progressOutline} onSelectTheme={selectThemeOutline}
          />
          </> : <div className="notebook-contents"><header><strong>Conversations</strong><button aria-label="New conversation" onClick={newQuestion}><span aria-hidden="true">+</span><span className="outline-full-label"> New</span></button></header>{catalogueEntries.map((entry, index) => <button className={entry.id === activeNotebook?.id ? "is-active" : ""} key={entry.id} aria-label={notebookTitle(entry)} title={notebookTitle(entry)} onClick={() => { patchState({ activeNotebookId: entry.id }); setMobileOutlineOpen(false); }}><span className="outline-full-label">{entry.pinned ? "⌖ " : ""}{notebookTitle(entry)}</span><span className="outline-rail-label" aria-hidden="true">{entry.pinned ? "⌖" : index + 1}</span><small>{entry.source?.nodeTitle ?? "Independent question"} · {entry.status}</small></button>)}{!catalogueEntries.length && <p>Linked passages and standalone questions appear here automatically.</p>}</div>}
          <div className="outline-footer">
            <div className="sidebar-chrome"><button type="button" aria-label={chromePreferences.sidebarPinned ? "Let sidebar contract" : "Keep sidebar expanded"} aria-pressed={chromePreferences.sidebarPinned} title={chromePreferences.sidebarPinned ? "Unpin sidebar" : "Pin sidebar open"} onClick={() => setChromePreferences((current) => ({ ...current, sidebarPinned: !current.sidebarPinned }))}><Pin size={13} /></button></div>
            <div className="compatibility-badge">
              <CheckCircle2 size={16} />
              <span><strong>Standard LaTeX</strong><small>Views stay on this computer</small></span>
            </div>
          </div>
        </aside>

        <main className={`editor-pane display-${state.displayMode}`} style={{ "--paper-editor-font": editorFont(document?.appearance?.family), "--paper-editor-size": `${(document?.appearance?.sizePt ?? 10) * 4 / 3}px` } as React.CSSProperties}>
          <div className={`editor-toolbar${toolbarControlsOpen ? " controls-open" : ""}`} ref={editorToolbarRef}>
            <button
              ref={outlineToggleRef}
              className="mobile-outline-button"
              aria-label={state.destination === "notebook" ? "Toggle conversation index" : "Toggle contents"}
              aria-expanded={narrowWorkspace ? mobileOutlineOpen : state.destination === "notebook" ? Boolean(state.notebookIndexVisible) : !state.outlineCollapsed}
              onClick={() => { if (window.matchMedia("(max-width: 820px)").matches) setMobileOutlineOpen(true); else patchState(state.destination === "notebook" ? { notebookIndexVisible: !state.notebookIndexVisible } : { outlineCollapsed: !state.outlineCollapsed }); }}
              type="button"
            >
              <ListTree size={16} />
            </button>
            <button className="paper-files-button" aria-label="Open Paper & files" aria-haspopup="dialog" aria-expanded={repositoryOpen} title={`Paper & files · ${document?.project.name ?? "Choose a paper"}`} disabled={manuscriptBusy || compiling || savingPaper || savingHandoff || sourceRefreshing || queueNavigating} onClick={openPaperFiles}><FolderOpen size={16} /></button>
            <button className="theme-toggle" type="button" aria-label={chromePreferences.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={chromePreferences.theme === "dark" ? "Light mode" : "Dark mode"} onClick={() => setChromePreferences(current => ({ ...current, theme: current.theme === "dark" ? "light" : "dark" }))}>{chromePreferences.theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}</button>
            <div className="breadcrumb">
              {state.destination === "manuscript" && navigationHistory.length > 0 && <button aria-label="Back to previous paper view" title="Back to previous paper view" onClick={() => {
                const { returnParagraphId, turboCursor, ...view } = navigationHistory.at(-1)!;
                flushParagraph();
                setState((current) => ({ ...current, ...view, turbo: { ...current.turbo, enabled: Boolean(turboCursor), activeParagraphId: turboCursor ?? current.turbo.activeParagraphId, atEnd: false } })); setNavigationHistory((previous) => previous.slice(0, -1));
                setJumpTarget({ nodeId: view.activeNodeId, paragraphId: returnParagraphId, sequence: Date.now() });
              }}><ArrowLeft size={15} /></button>}
              <span title={document?.project.name}>{document?.project.name ?? "Loading paper"}</span><span>/</span><span title="Current source file">{state.destination === "notebook" ? "Notebook" : paragraphs.find(p => p.id === handoffParagraphId)?.file ?? document?.project.mainFile}</span><strong>{state.destination === "notebook" ? activeNotebook?.title ?? "Questions" : activeNode.title}</strong>
            </div>
            {autoSaveError && saveNoticeCollapsed && <button className="save-warning-badge" title={autoSaveError} onClick={() => setSaveNoticeCollapsed(false)}>Save paused</button>}
            {incomingSource && sourcePlan?.conflicts.length ? <button className="save-warning-badge" title="Another editor changed this passage. Your draft is kept; compare both versions." onClick={() => setSourcePanelOpen(open => !open)}>Other edits · {sourcePlan.conflicts.length}</button> : null}
            <NotebookLink key={document?.project.id} destination={state.destination} entries={linkedNotebookEntries} readyEntries={readyNotebookEntries} openedEntryId={state.activeNotebookId} onOpen={openLinkedNotebook} />
            <PriorityQueue settings={state.suggestions} tasks={queueTasks} suggestion={workSuggestion} onSettings={(suggestions) => patchState({ suggestions })}
              scope={queueView.scope} onScope={scope => setQueueView(current => touchQueueView({ ...current, scope }))} queueLoading={projectQueue.loading} queueError={projectQueue.error} navigating={queueNavigating}
              activeId={currentQueueTask && document ? projectQueueId(document.project.id, currentQueueTask.id) : queueCursor}
              activeLabel={currentQueueTask ? `Finish: ${attentionTaskLocation(currentQueueTask, document)}` : currentCheckParagraph ? "Mark this block checked / unchecked; no mathematical verification" : undefined} activeChecked={!currentQueueTask && Boolean(currentCheckParagraph && reviewed(state.turbo, currentCheckParagraph.id, state.paragraphEdits[currentCheckParagraph.id] ?? currentCheckParagraph.text))} onFinishActive={currentQueueTask || currentCheckParagraph ? checkActiveItem : undefined}
              onNext={nextUsefulPlace} onReturn={task => void useQueueItem(task, "return")} onCopy={task => void useQueueItem(task, "copy")} onDismiss={id => queueActionById(id, "finish")} onReopen={id => queueActionById(id, "reopen")}
              onReady={task => void useQueueItem(task, "reply")} onResolveComment={(id, resolved) => queueActionById(id, "comment", resolved)} onFinishWithoutImport={id => queueActionById(id, "finish")}
              resolveCommentsProjectId={document?.project.id} resolvableCommentIds={queueTasks.filter(task => task.projectId === document?.project.id).map(task => task.id)} onResolveComments={resolveProjectComments}
              taskLabel={task => { const item = task as ProjectQueueTask; return `${queueView.scope === "all" ? `${item.projectName} · ` : ""}${item.location}`; }} onMove={moveQueueItem}
              onResetColors={() => queueView.scope === "all" ? setQueueView(current => ({ ...touchQueueView(current), colorsResetAt: new Date().toISOString() })) : setState(current => resetQueueColors(current))} />
            {state.destination === "manuscript" && <select className="manuscript-scope-select" aria-label="Manuscript scope" title="All sections, one section, or a moving block window. Hidden sections stay hidden." disabled={!document || scopeChanging} value={preambleEditing ? "file" : state.lens === "themes" ? "themes" : state.turbo.enabled ? "turbo" : manuscriptScope(state)} onChange={event => {void changeManuscriptScope(event.target.value as ManuscriptScope);}}>
              {preambleEditing && <option value="file">Full-file source</option>}
              {state.lens === "themes" && <option value="themes">Theme excerpts</option>}
              {state.turbo.enabled && <option value="turbo">Wording pass</option>}
              <option value="all">All sections</option><option value="section">This section</option><option value="window">Block window</option>
            </select>}
            {state.destination === "manuscript" && (state.focusedNodeId || state.blockWindow || state.turbo.enabled || state.lens === "themes" || preambleEditing) && <button className="theme-toggle exit-focus-button" disabled={!document || scopeChanging} aria-label="Exit focus · Show all sections" title="Exit focus · Show all sections" onClick={() => void changeManuscriptScope("all")}><Maximize2 size={14} aria-hidden="true" /></button>}
            {state.destination === "manuscript" && <div className="view-controls">
              <button className="reference-toolbar-button manuscript-ask-button" aria-expanded={manuscriptPromptOpen} disabled={!document || savingHandoff} onClick={() => manuscriptPromptOpen ? setManuscriptPromptOpen(false) : askInManuscript()}><MessageSquareText size={14} /> Ask</button>
              <button className="reference-toolbar-button source-preview-button" aria-label="Show source in preview" title="Show the current source passage in the PDF or rendered text" disabled={!document || !state.activeParagraphId || compiling} onClick={() => {
                const paragraphId = pendingSelection?.paragraphId ?? sourcePositionReader.current?.()?.paragraphId ?? state.activeParagraphId;
                if (paragraphId) syncToPreview(paragraphId);
              }}><Scan size={14} /> Show in preview</button>
              <div className="toolbar-secondary-controls" id="manuscript-toolbar-controls">
              <WorkspaceTools context={state.turbo.enabled ? "the active paragraph" : activeNode.title} disabled={!document || savingHandoff}
                onExplore={exploreSelection} onRewrite={rephraseCurrentParagraph} onChat={() => openPassageTool("chatgpt")} onAgent={() => openPassageTool("codex")} onReview={() => openReview()} onWrite={() => openWriting()} />
              <ToolbarDetails key={document?.project.id} className="view-more" onClose={() => setDisplayMenuOpen(false)} summary={<>View <ChevronDown size={12} /></>}><div className="view-more-panel">
              <button className="reference-toolbar-button" onClick={() => setWorkbenchDetailsOpen((open) => !open)}>Saved work & recovery</button>
              <button disabled={!document || manuscriptBusy} onClick={() => { void copyPassageLink(); }}><Link2 size={14} /> Copy passage link</button>
              <button className="reference-toolbar-button" title="Browse cited papers or internal labels" onClick={() => {
                const keys = [...new Set(paragraphs.flatMap((paragraph) => referenceTokens(state.paragraphEdits[paragraph.id] ?? paragraph.text).filter((token) => token.kind === "citation").flatMap((token) => token.keys)))];
                openReference({ inspect: true, token: { kind: keys.length ? "citation" : "label", keys: keys.length ? keys : [...new Set(document?.labels?.map((label) => label.key) ?? [])], raw: "", start: 0, end: 0 } });
              }}><Link2 size={14} /> Links</button>
              {sourceMonitor.changed && <span className="source-check-button has-changes" title="Open Paper & files → Source changes & drafts">Files changed</span>}
              <span className="local-view-label"><Eye size={14} /> LaTeX source · local view</span>
              <div className="display-control" ref={displayControlRef}>
                <button
                  className="display-button"
                  aria-label="Editor appearance"
                  title="Editor appearance · does not change the paper"
                  data-keep-toolbar-open
                  aria-expanded={displayMenuOpen}
                  onClick={() => setDisplayMenuOpen((open) => !open)}
                  type="button"
                >
                  <Type size={14} />
                  <span>{displayMode.label}</span>
                  <ChevronDown size={12} />
                </button>
                {displayMenuOpen && (
                  <div className="display-menu">
                    <div className="display-menu-note">
                      <strong>Editor appearance</strong>
                      <span>Changes this editor only, not the PDF or shared LaTeX.</span>
                      <span>{document?.appearance?.description ?? "Paper font not detected"}. Approximate; use PDF for exact layout.</span>
                    </div>
                    {displayModes.map((mode) => (
                      <button
                        className={state.displayMode === mode.id ? "is-active" : ""}
                        key={mode.id}
                        onClick={() => {
                          patchState({ displayMode: mode.id });
                          setDisplayMenuOpen(false);
                        }}
                        type="button"
                      >
                        <span className="display-swatch" data-mode={mode.id}>Aa</span>
                        <span>
                          <strong>{mode.label}</strong>
                          <small>{mode.description}</small>
                        </span>
                        {state.displayMode === mode.id && <CheckCircle2 size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </div></ToolbarDetails>
              </div>
              <label className="manuscript-view-control">View<select aria-label="Manuscript view" title="Editor and preview layout" disabled={!document} value={state.previewMode} onChange={event => showLatexLayout(event.target.value as AppState["previewMode"])}>
                <option value="hidden">Source</option>
                <option value="split">Split</option><option value="full">Preview</option>
              </select></label>
              <label className="manuscript-view-control">Preview<select aria-label="Preview format" title="Rendered text or compiled PDF" disabled={!document || state.previewMode === "hidden"} value={previewFormat} onChange={event => setPreviewFormat(event.target.value as typeof previewFormat)}>
                <option value="reading">Rendered text</option><option value="pdf">LaTeX PDF</option>
              </select></label>
              <div className="compile-control" ref={compileControlRef}>
                <button className="primary-button compile-main" disabled={compiling || !document} aria-label={compiling ? "Compiling…" : "Compile"}
                  title={state.turbo.enabled ? "Compile the active paragraph's containing section. Navigation doesn't recompile." : "Compile the visible view"} onClick={() => void compileLatex("focus")} type="button">
                  <Play size={12} fill="currentColor" /> <span>{compiling ? "Compiling…" : "Compile"}</span>
                </button>
                <button className="primary-button compile-menu-button" aria-label="Compile options" aria-expanded={compileMenuOpen} aria-controls="compile-options" disabled={compiling || !document} onClick={() => setCompileMenuOpen(open => !open)} type="button"><ChevronDown size={12} /></button>
                {compileMenuOpen && <div className="compile-menu" id="compile-options" aria-label="Compile options">
                  <button disabled={compiling} onClick={() => void compileLatex("focus")}><strong>Compile view</strong><small>Visible sections or blocks · faster</small></button>
                  <button disabled={compiling} onClick={() => void compileLatex("full", true)}><strong>Original pages</strong><small>Current section · reuse full PDF or update full build</small></button>
                  <button disabled={compiling} onClick={() => void compileLatex("full")}><strong>Compile full paper</strong><small>Complete layout · before sharing</small></button>
                  {document && <PdfDownload key={`${document.project.id}:${document.project.mainFile}`} result={compileResult} projectId={document.project.id} projectName={document.project.name} mainFile={document.project.mainFile} stale={Boolean(compileResult?.stale || Object.keys(state.paragraphEdits).length || compileResult?.sourceRevision && compileResult.sourceRevision !== document.revision)} />}
                  {document && <SourceZipDownload key={document.project.id} projectId={document.project.id} onSave={savePaper} />}
                  {document && <CollaboratorDownload key={document.project.id} projectId={document.project.id} roots={document.rootFiles} purposes={document.project.manuscriptPurposes} entryId={manuscriptPrompt?.recoveryKey ? undefined : manuscriptPrompt?.id} blocked={!notebookStorage.ready || notebookStorage.pending || notebookStorage.saving || Boolean(notebookStorage.error)} onSave={savePaper} notebookRevision={() => latestState.current.notebookRevision ?? 0} />}
                </div>}
              </div>
              <div className="latex-control" ref={latexControlRef} aria-label="LaTeX editor and tools">
                <button className="latex-editor-button" aria-label="LaTeX editor" title="Open LaTeX source editing" disabled={!document} onClick={() => showLatexLayout(state.previewMode === "full" ? "split" : state.previewMode)} type="button">
                  <span className="latex-logo" aria-hidden="true">L<span className="latex-logo-a">A</span>T<span className="latex-logo-e">E</span>X</span>
                </button>
                <button className="latex-menu-button" aria-label="LaTeX options" aria-expanded={latexMenuOpen} aria-controls="latex-options" disabled={!document} title="PDF controls, build details, and warnings" onClick={() => setLatexMenuOpen(open => !open)} type="button"><ChevronDown size={12} /></button>
                {latexMenuOpen && <div className="compile-menu latex-menu" id="latex-options" aria-label="LaTeX options">
                  <div className="preview-options-host" ref={setPreviewControlsTarget} />
                  {state.previewMode === "hidden" && <p className="latex-menu-hint">Choose a preview from View to see PDF controls.</p>}
                  <button className="latex-warnings-button" aria-label="LaTeX warnings and fixes" onClick={() => { setLatexMenuOpen(false); setReviewOpen(false); openPassageTool("latex"); }}><TriangleAlert size={14} /><span>Warnings & fixes</span></button>
                </div>}
              </div>
              <button className="toolbar-reveal-button" aria-label="Toggle toolbar controls" aria-controls="manuscript-toolbar-controls" aria-pressed={toolbarControlsOpen} title="More editing and view controls" type="button" onClick={() => setToolbarControlsOpen((open) => !open)}><MoreHorizontal size={15} /></button>
            </div>}
          </div>

          {state.destination !== "notebook" && manuscriptPromptOpen && manuscriptPrompt && document && <Suspense fallback={toolLoading}><ManuscriptPrompt key={manuscriptPrompt.id} entry={manuscriptPrompt} document={document} dispatching={savingHandoff}
            onClose={() => setManuscriptPromptOpen(false)} onNew={() => askInManuscript(true)}
            onPatch={(patch) => patchNotebook(manuscriptPrompt.id, patch)} onHandoff={prepareNotebookHandoff} onLocalStudy={runNotebookStudy}
            onImportReply={(id, reply) => importPastedReply(id, reply, document.project.id)} onFinishWithoutImport={finishExternalTask} onFinishTask={finishQueueTask} onReopenTask={reopenTask}
            onContinue={nextUsefulPlace} onReference={openReference} /></Suspense>}
          {state.destination === "manuscript" && !preambleEditing && blockWindow && <BlockWindowBar index={blockWindow.index} total={blockWindow.total} radius={blockWindow.radius} disabled={turboBlocked} onMove={moveBlockWindow} onRadius={radius => setState(current => ({ ...current, blockWindow: { ...current.blockWindow, radius } }))} />}
          <div className={`editor-stage preview-${effectivePreviewMode}`} style={paneSplit.style}>
          {effectivePreviewMode !== "full" && (
          <section className="editing-surface">
          {state.destination === "notebook" && document ? <Suspense fallback={toolLoading}><ResearchNotebook key={document.project.id} entry={activeNotebook} entries={manuscriptNotebookEntries.some(e => e.id === activeNotebook?.id) || !activeNotebook ? manuscriptNotebookEntries : [...manuscriptNotebookEntries, activeNotebook]} collapsedIds={state.collapsedNotebookIds ?? []}
            onToggle={(entry, open) => setState((current) => toggleNotebookConversation(current, entry.id, open))}
            onNavigatePhase={navigateNotebookPhase}
            sourceFor={(entry) => { const passage = locateSavedPassage(entry.source, document, state.paragraphEdits); return passage ? paragraphText(state, passage.id, paragraphs) : undefined; }} document={document}
            trustedExperiments={trustedExperimentProject === document.project.id} onTrustExperiments={(trusted) => setTrustedExperimentProject(trusted ? document.project.id : undefined)}
            currentSource={activeNotebookPassage ? paragraphText(state, activeNotebookPassage.id, paragraphs) : undefined}
            saving={notebookStorage.saving} pending={notebookStorage.pending} error={notebookStorage.error} onRecover={notebookStorage.recover}
            shareControl={<CollaboratorDownload compact projectId={document.project.id} roots={document.rootFiles} purposes={document.project.manuscriptPurposes} entryId={activeNotebook?.recoveryKey ? undefined : activeNotebook?.id} blocked={!notebookStorage.ready || notebookStorage.pending || notebookStorage.saving || Boolean(notebookStorage.error)} onSave={savePaper} notebookRevision={() => latestState.current.notebookRevision ?? 0} />}
            onNew={newQuestion} onPatch={patchNotebook}
            allEntries={state.notebookEntries} onTransfer={transferNotebookContents}
            onReorder={(id,target,before)=>setState(current=>moveNotebookEntry(current,id,target,before))}
            onFile={(id,filed,folder)=>setState(current=>fileNotebookEntry(current,id,filed,folder))}
            onReturn={returnFromNotebook} onApply={applyNotebookProposal} onHandoff={prepareNotebookHandoff} onImportReply={(id, reply) => importPastedReply(id, reply, document?.project.id)}
            passageHrefFor={entry => notebookPassageUrl(window.location.href, entry, document, state)}
            evidenceTarget={initialWindowRequest?.projectId === document.project.id && initialWindowRequest.panel === "notebook" && initialWindowRequest.notebookId === activeNotebook?.id && initialWindowRequest.cellId ? initialWindowRequest : undefined}
            onFinishWithoutImport={finishExternalTask} onFinishTask={finishQueueTask} onReopenTask={reopenTask}
            onLocalStudy={runNotebookStudy} dispatching={savingHandoff} onContinue={nextUsefulPlace} onReference={openReference}
            onRefreshSource={(entry) => { if (!entry.source || !document) return; if (entry.source.passages) { setToast("Highlight the current blocks and start a new question to change this context. All original excerpts and notes are kept."); return; } const paragraph = locateSavedPassage(entry.source, document, latestState.current.paragraphEdits); if (!paragraph) { setToast("The original passage can't be found reliably. Choose it again in Manuscript view."); return; }
              const text = paragraphText(state, paragraph.id, paragraphs); patchNotebook(entry.id, { source: { ...entry.source, returnAnchor: undefined, paragraphId: paragraph.id, nodeId: paragraph.nodeId, paragraphText: text, excerpt: text, start: 0, end: text.length, revision: document.revision,
                duplicateAtCapture: paragraphs.filter((p) => p.file === paragraph.file && paragraphText(latestState.current, p.id, paragraphs) === text).length > 1 } }); }} /></Suspense> : <>
          {state.turbo.enabled && <TurboBar turbo={state.turbo} position={turboWindow.index} total={pass.length} checked={turboChecked} waiting={new Set(openTasks.filter((task) => task.paragraphId && pass.some((paragraph) => paragraph.id === task.paragraphId)).map((task) => task.paragraphId)).size} disabled={turboBlocked} onPatch={patchTurbo} onMove={moveTurbo} onUndo={undoTurbo} onPolish={polishTurboParagraph} onResume={() => resumeTurboReply()} />}
          {state.lens === "themes" && activeTheme ? (
            <ThemeWorkspace
              writingMarkers={manuscriptWritingMarkers} onWritingReview={openWritingReview}
              explicitBlocks={state.sourcePresentation==="blocks"}
              readOnly={environmentBusy || reviewOpen && !reviewEditing || manuscriptBusy}
              onChunkAction={(action,selection)=>{void useChunk(action,selection);}}
              hasBlockContext={blockHasContext} isQueued={isPassageQueued}
              key={`${activeTheme.id}:source-${documentEpoch}`}
              theme={activeTheme}
              paragraphs={paragraphs}
              nodes={manuscriptNodes}
              paragraphEdits={state.paragraphEdits}
              onParagraphEdit={updateParagraph}
              onParagraphFocus={(paragraphId, nodeId) => patchState({ activeParagraphId: paragraphId, activeNodeId: nodeId })}
              onSyncToPreview={syncToPreview}
              onReference={openReference}
              onRewrite={(paragraphId) => { const paragraph = paragraphs.find((item) => item.id === paragraphId); if (!paragraph) return; const text = flushParagraph(paragraphId); requestRewrite({ paragraphId, nodeId: paragraph.nodeId, start: 0, end: text.length, text }, text); }}
              onComposerChange={(composerText) => setState((current) => ({ ...current, themeLenses: current.themeLenses.map((theme) => theme.id === current.activeThemeId ? { ...theme, composerText } : theme) }))}
              onDraftEdit={(draftId, text) => setState((current) => ({ ...current, themeLenses: current.themeLenses.map((theme) => theme.id === current.activeThemeId ? { ...theme, drafts: theme.drafts?.map((draft) => draft.id === draftId ? { ...draft, text } : draft) } : theme) }))}
              onExclude={(paragraphId) =>
                setState((current) => ({
                  ...current,
                  themeLenses: current.themeLenses.map((theme) =>
                    theme.id === current.activeThemeId
                      ? { ...theme, matches: theme.matches.map((match) =>
                          match.paragraphId === paragraphId ? { ...match, excluded: true } : match) }
                      : theme,
                  ),
                }))
              }
              onPin={(paragraphId) =>
                setState((current) => ({
                  ...current,
                  themeLenses: current.themeLenses.map((theme) =>
                    theme.id === current.activeThemeId
                      ? { ...theme, matches: theme.matches.map((match) =>
                          match.paragraphId === paragraphId ? { ...match, pinned: !match.pinned } : match) }
                      : theme,
                  ),
                }))
              }
              onAddExisting={(paragraphId) =>
                setState((current) => ({
                  ...current,
                  themeLenses: current.themeLenses.map((theme) => {
                    if (theme.id !== current.activeThemeId) return theme;
                    const existing = theme.matches.find((match) => match.paragraphId === paragraphId);
                    return {
                      ...theme,
                      matches: existing
                        ? theme.matches.map((match) =>
                            match.paragraphId === paragraphId
                              ? { ...match, excluded: false, pinned: true }
                              : match,
                          )
                        : [...theme.matches, { paragraphId, score: 1, pinned: true }],
                    };
                  }),
                }))
              }
              onAddDraft={(text) =>
                setState((current) => ({
                  ...current,
                  themeLenses: current.themeLenses.map((theme) =>
                    theme.id === current.activeThemeId
                      ? {
                          ...theme,
                          composerText: "",
                          drafts: [
                            ...(theme.drafts ?? []),
                            {
                              id: `theme-draft-${Date.now()}`,
                              text,
                              createdAt: new Date().toISOString(),
                            },
                          ],
                        }
                      : theme,
                  ),
                }))
              }
              onRemoveDraft={(draftId) =>
                setState((current) => ({
                  ...current,
                  themeLenses: current.themeLenses.map((theme) =>
                    theme.id === current.activeThemeId
                      ? { ...theme, drafts: (theme.drafts ?? []).filter((draft) => draft.id !== draftId) }
                      : theme,
                  ),
                }))
              }
              onJumpToSource={(paragraphId) => {
                const paragraph = paragraphs.find((item) => item.id === paragraphId);
                if (!paragraph) return;
                navigateNode(paragraph.nodeId, paragraph.id);
                patchState({ lens: "paper" });
              }}
            />
          ) : state.lens === "themes" ? (
            <div className="empty-editor"><Sparkles size={24} /><strong>No saved themes yet</strong><span>Select a passage in Manuscript view and choose Theme.</span></div>
          ) : preambleEditing && document ? (
            <PlainSourceEditor key={`plain:${document.project.id}:${plainFile && document.files.includes(plainFile)?plainFile:document.project.mainFile}`} document={document} file={plainFile && document.files.includes(plainFile)?plainFile:document.project.mainFile} flushRef={plainSourceFlush} jump={jumpTarget} preamble={jumpTarget?.nodeId==="preamble"} readOnly={environmentBusy || reviewOpen && !reviewEditing || manuscriptBusy} onClose={async()=>{try{await savePaper();setPreambleEditing(false);}catch(reason){setToast((reason as Error).message);}}}
              onSyncToPreview={syncToPreview} onFile={async file=>{await openPlainSource(file);}} onFocus={(paragraphId,nodeId)=>{if(!state.turbo.enabled)patchState({activeParagraphId:paragraphId,activeNodeId:nodeId});}}
              onSaved={after=>{const before=latestDocument.current;if(!before || before.project.id!==after.project.id || before.project.mainFile!==after.project.mainFile)return;const next=refreshSourceState(latestState.current,before,after);latestState.current=next;latestDocument.current=after;setState(next);setDocument(after);setCompileStale(true);announceSaved(after.project.id,"source");}}/>
          ) : (
            <Manuscript
              sectionNavigation={sectionNavigation}
              explicitBlocks={state.sourcePresentation==="blocks"}
              commandEditing={commandEditing}
              onOpenSourceCommand={command=>{void openPlainSource(command.file,false,command.start);}}
              key={`source-${documentEpoch}`}
              lens={state.lens}
              nodes={manuscriptNodes}
              paragraphs={paragraphs}
              activeNodeId={state.activeNodeId}
              focusedNodeId={state.focusedNodeId}
              hiddenNodeIds={state.hiddenNodeIds}
              paragraphEdits={state.paragraphEdits}
              rewriteSessions={state.rewriteSessions}
              writingMarkers={manuscriptWritingMarkers} onWritingReview={openWritingReview}
              pendingSelection={pendingSelection}
              commentHighlight={activeCommentHighlight}
              readOnly={environmentBusy || reviewOpen && !reviewEditing || manuscriptBusy}
              blockTypes={blockTypes}
              onSelectNode={(nodeId) => state.turbo.enabled ? navigateNode(nodeId) : patchState({ activeNodeId: nodeId })}
              onParagraphEdit={updateParagraph}
              onJoinParagraphs={(previousId, currentId, previousText, currentText) => void changeParagraphJoin(previousId, currentId, previousText, currentText)}
              onUndoParagraphJoin={id => { const undo = paragraphJoinUndo.current; if (undo?.paragraphId === id) void changeParagraphJoin(undefined, undefined, undefined, undefined, undo); }}
              onParagraphFocus={(paragraphId, nodeId) => { if (!state.turbo.enabled) patchState({ activeParagraphId: paragraphId, activeNodeId: nodeId }); }}
              onSyncToPreview={syncToPreview}
              onSelection={setPendingSelection}
              onBeginRewrite={beginRewrite}
              onOpenRewrite={openSavedRewrite}
              onCreateTheme={createThemeFromSelection}
              onExplore={exploreSelection}
              onComment={() => addReviewComment()} onReviewLater={() => toggleLater()}
              blockCommentCounts={blockCommentCounts} onOpenBlockComments={id => { const first = blockComments[id]?.[0]; if (first) openReview(first, id); }}
              isQueued={isPassageQueued}
              onChunkAction={(action, selection) => void useChunk(action, selection)}
              hasBlockContext={blockHasContext}
              onReference={openReference}
              jumpTarget={jumpTarget}
              positionReader={sourcePositionReader}
              onViewportExit={position => {
                if (!document) return;
                const paragraph = paragraphs.find(p => p.id === position.paragraphId); if (!paragraph) return;
                manuscriptReturnPositions.current.set(`${document.project.id}:${document.project.mainFile}`, {...position, file: paragraph.file,
                  paragraphText: state.paragraphEdits[paragraph.id] ?? paragraph.text, revision: document.revision});
              }}
              blockWindow={blockWindow ? { ...blockWindow, blocked: turboBlocked } : undefined}
              onWindowFocus={scrollBlockWindow}
              onWindowNavigate={id => {
                if (!blockWindow || turboBlocked) return;
                const target = blockWindow.available.find(p => p.id === id); if (!target) return;
                flushParagraph(); setPendingSelection(undefined);
                setState(current => ({ ...current, activeNodeId: target.nodeId, activeParagraphId: id, focusedNodeId: undefined, blockWindow: current.blockWindow ? { ...current.blockWindow, paragraphId: id } : undefined }));
                setJumpTarget({nodeId: target.nodeId, paragraphId: id, sequence: Date.now()});
              }}
              turbo={state.turbo.enabled && turboParagraph ? { activeId: turboParagraph.id, index: turboWindow.index, radius: state.turbo.context, available: pass, paragraphs: turboWindow.paragraphs, before: turboWindow.before, after: turboWindow.after,
                checked: reviewed(state.turbo, turboParagraph.id, paragraphText(state, turboParagraph.id, paragraphs)), waiting: openTasks.some((task) => task.paragraphId === turboParagraph.id), autoCheck: state.turbo.autoCheck, blocked: turboBlocked || Boolean(state.turbo.reviewingTaskId), atEnd: state.turbo.atEnd } : undefined}
              onTurboFocus={focusTurboParagraph}
              onTurboScroll={scrollTurboParagraph}
            />
          )}

          </>}
          <WorkbenchStatus {...workbenchStorage} visible={workbenchDetailsOpen} recoveredDrafts={state.recoveredWorkbenchDrafts ?? []} onRecover={workbenchStorage.recover}
            onRestore={(id) => { setState((current) => restoreWorkbenchDraft(current, id)); setToast("Recovered copy kept; no request was sent or paper changed."); }}
            onCopy={(draft) => void navigator.clipboard.writeText(draft.kind === "task" ? draft.value.replyDraft || draft.value.reply || draft.value.packet || "" : draft.kind === "rewrite" ? draft.value.candidates.filter((candidate) => !candidate.dismissed).map((candidate) => candidate.text).join("\n\n") : draft.value.instruction).then(() => setToast("Recovered text copied.")).catch(() => setToast("Clipboard unavailable; copy from Saved details."))} />
          </section>
          )}

          {effectivePreviewMode === "split" && <PaneDivider share={paneSplit.share} onChange={paneSplit.change} />}
          {state.previewMode !== "hidden" && (
            <div className="preview-dock" hidden={effectivePreviewMode === "hidden"}>
              <Preview
                figureProject={document}
                sectionNavigation={sectionNavigation}
                recoveryIdentity={document ? { key: `preview:${document.project.id}:${document.project.mainFile}:${state.lens}:${state.focusedNodeId ?? "all"}`, revision: document.revision } : undefined}
                jumpTarget={previewJumpTarget} onSyncToSource={syncToSource} onPdfSourcePosition={(page, x, y) => void syncPdf("inverse", { page, x, y })}
                onReference={openReference} onNavigateNode={navigateNode}
                darkPdf={chromePreferences.darkPdf}
                format={previewFormat} controlsTarget={previewControlsTarget}
                active={effectivePreviewMode !== "hidden"}
                lens={state.lens}
                focusedNodeId={state.turbo.enabled || blockWindow ? undefined : state.focusedNodeId}
                paragraphIds={state.turbo.enabled ? turboPreviewIds : blockWindowIds}
                blockWindowNavigation={blockWindow ? { before: blockWindow.before, after: blockWindow.after, blocked: turboBlocked || Boolean(pendingSelection), onMove: moveBlockWindow } : undefined}
                hiddenNodeIds={state.hiddenNodeIds}
                nodes={manuscriptNodes}
                paragraphs={paragraphs}
                paragraphEdits={state.paragraphEdits}
                theme={activeTheme}
                compileResult={compileResult ? { ...compileResult, stale: Boolean(compileResult.stale || Object.keys(state.paragraphEdits).length || (compileResult.sourceRevision && compileResult.sourceRevision !== document?.revision)) } : undefined}
                compiling={compiling}
              />
            </div>
          )}
          </div>
        </main>

        {(writingOpen || reviewOpen || activeRewrite || activeHandoff || latexAssistantOpen || referenceRequest || replyTask) && (
          <aside className="inspector-pane">
            {reviewOpen && document && <Suspense fallback={toolLoading}><ReviewPanel key={document.project.id} document={document} tasks={state.attentionTasks} edits={state.paragraphEdits} selectedId={reviewTaskId} instructions={state.handoffDrafts ?? {}} busy={savingHandoff} protectedText={!reviewEditing} onProtect={protect => setReviewEditing(!protect)}
              blockComments={reviewBlockId ? blockComments[reviewBlockId] ?? [] : undefined} onAllComments={() => setReviewBlockId(undefined)} onOutsideComment={task => openReview(task)}
              onReply={replyToComment}
              onClose={() => setReviewOpen(false)} onSelect={task => openReview(task, reviewBlockId)} onJump={jumpToComment} onAdd={() => addReviewComment()} onEdit={(id, body) => setState(current => editReviewComment(current, id, body))} onResolve={resolveComment}
              onAsk={task => useReviewTool(task, false)} onRewrite={task => useReviewTool(task, true)}
              onInstructions={(mode, instruction) => setState(current => ({ ...current, handoffDrafts: { ...current.handoffDrafts, [`review:${mode}`]: { ...defaultHandoff("codex", true), instruction } } }))}
              onExport={prepareReview} onSavePacket={saveReviewPacket} onImport={(id, reply) => { importPastedReply(id, reply, document.project.id); }}
              onDraftReply={(id, replyDraft) => setState(current => ({ ...current, attentionTasks: current.attentionTasks.map(t => t.id === id ? { ...t, replyDraft, error: undefined } : t) }))} onArchive={dismissTask} /></Suspense>}
            {writingOpen && document && <Suspense fallback={toolLoading}><WritingPanel key={document.project.id} tasks={state.attentionTasks} document={document} edits={state.paragraphEdits} selectedId={writingTaskId} instruction={state.handoffDrafts?.writing?.instruction ?? ""} theme={activeTheme} busy={savingHandoff || savingPaper || manuscriptBusy}
              onClose={() => setWritingOpen(false)} onSelect={returnToTask} onInstruction={instruction => setState(current => ({ ...current, handoffDrafts: { ...current.handoffDrafts, writing: { ...defaultHandoff("codex", true), instruction } } }))}
onPrepare={prepareWriting} onFullNote={instruction => askInManuscript(true, undefined, `${manuscriptPurpose(document.project) === "overview" ? `Write a short collaborator overview (a few paragraphs or about a page), explaining the aim, main idea, current status and next step. Link to ${document.project.manuscriptOverviewTargets?.[document.project.mainFile] ?? "the main manuscript (ask which root if unspecified)"} for details. Do not turn this into a full research note. This request permits writing ${document.project.mainFile} only; preserve human work and locks.\n\n${instruction}` : `Write a full informative research note in ${document.project.mainFile}, not a publication draft. Use as much explanation and derivation as useful, preserve existing human work and wording locks, and link evidence to the notebook. This request permits writing this notes manuscript only.\n\n${instruction}`}`)} onImport={(id, reply) => { importPastedReply(id, reply, document.project.id); }} onReplyDraft={(id, replyDraft) => setState(current => ({ ...current, attentionTasks: current.attentionTasks.map(t => t.id === id ? { ...t, replyDraft } : t) }))}
              onDraft={(id, text) => setState(current => editWritingDraft(current, id, text))} onPlace={id => changeWriting(id, "place")} onEdit={updateParagraph} onAccept={(id, text) => changeWriting(id, "approve", text)} onDrop={id => changeWriting(id, "drop")}
              onTogether={showWritingTogether} onNextWork={task => { setWritingOpen(false); continueUsefulWork(task); }} onCopy={task => void copyTaskPrompt(task)} onFinishRound={dismissTask} onUnlock={id => setState(current => unlockWritingParagraph(current, id))} onFeedback={(id, feedback) => setState(current => editWritingFeedback(current, id, feedback))} /></Suspense>}
            {!writingOpen && !reviewOpen && <>
            <Suspense fallback={toolLoading}>
            {replyTask ? <HandoffReply key={replyTask.id} task={replyTask} sourceCheck={replySource} onInspectPosition={(paragraph) => { navigateNode(paragraph.nodeId, paragraph.id); setJumpTarget({ nodeId: paragraph.nodeId, paragraphId: paragraph.id, sequence: Date.now() }); setToast("This is text at the old position, not a confirmed match. Nothing was changed."); }} onReply={(reply) => setState((current) => receiveHandoffReply(current, replyTask.id, reply))} onImportReply={(reply) => importPastedReply(replyTask.id, reply, document?.project.id)} onCopy={() => void copyTaskPrompt(replyTask)} onClose={() => setReplyTaskId(undefined)} onFinish={() => finishReplyReview(replyTask)} onFinishWithoutImport={() => finishExternalTask(replyTask.id)} onReopen={() => reopenTask(replyTask.id)} onFollowUp={() => followUpReply(replyTask)} onPrevious={state.attentionTasks.some((task) => task.id === replyTask.previousTaskId) ? () => returnToTask(state.attentionTasks.find((task) => task.id === replyTask.previousTaskId)!) : undefined} canResume={Boolean(state.handoffResume)} /> : referenceRequest && document ? (
              <ReferenceDrawer key={document.project.id} document={document} request={referenceRequest} onClose={() => setReferenceRequest(undefined)} onJump={jumpToLabel} />
            ) : activeRewrite ? (
              <RewriteDrawer
                session={activeRewrite}
                onClose={() => setActiveRewriteId(undefined)}
                onUpdate={(updates) => patchRewrite(activeRewrite.id, updates)}
                onUpdateCandidate={(candidateId, updates) =>
                  patchRewrite(activeRewrite.id, (current) => ({
                    ...current,
                    candidates: current.candidates.map((candidate) =>
                      candidate.id === candidateId ? { ...candidate, ...updates } : candidate,
                    ),
                    updatedAt: new Date().toISOString(),
                  }))
                }
                onAddCandidate={() => addCandidate(activeRewrite)}
                onGenerateRules={() => generateMore(activeRewrite)}
                onDispatch={() => dispatchRewrite(activeRewrite)}
                dispatching={savingHandoff}
                task={openTasks.find((task) => task.sessionId === activeRewrite.id)}
                onCopyTask={copyTaskPrompt}
                onReplyTask={(task) => setReplyTaskId(task.id)}
                onApply={() => applyRewrite(activeRewrite)}
                savedSessions={state.rewriteSessions.filter((session) => session.paragraphId === activeRewrite.paragraphId && ["draft", "stale"].includes(session.status))}
                onOpenSession={openSavedRewrite}
                onCheckSource={() => {
                  const source = paragraphs.some((paragraph) => paragraph.id === activeRewrite.paragraphId) ? flushParagraph(activeRewrite.paragraphId) : undefined;
                  if (rewriteSourceMatches(activeRewrite, source, id => paragraphs.some(p => p.id === id) ? flushParagraph(id) : undefined)) { patchRewrite(activeRewrite.id, { status: "draft" }); setToast("The selected passage still matches. Check alternatives before using them."); }
                  else setToast("The passage changed or disappeared. Select it again; saved alternatives are still available.");
                }}
              />
            ) : activeHandoff ? (
              <AgentHandoff
                key={`${document?.project.id}:${activeHandoff}:${activeNode.id}`}
                projectId={document!.project.id}
                document={document!}
                projectFolder={document?.project.folder}
                mainFile={document?.project.mainFile}
                mode={activeHandoff}
                node={activeNode}
                nodes={manuscriptNodes}
                paragraphId={handoffParagraphId}
                draft={state.handoffDrafts?.[`${activeHandoff}:${activeNode.id}`] ?? defaultHandoff(activeHandoff, true)}
                previousTask={state.attentionTasks.find((task) => task.id === state.handoffDrafts?.[`${activeHandoff}:${activeNode.id}`]?.previousTaskId)}
                onPatch={(patch) => setState((current) => { const key = `${activeHandoff}:${activeNode.id}`; return { ...current, handoffDrafts: { ...current.handoffDrafts, [key]: { ...(current.handoffDrafts?.[key] ?? defaultHandoff(activeHandoff, true)), ...patch } } }; })}
                paragraphs={paragraphs}
                paragraphEdits={state.paragraphEdits}
                onClose={() => setActiveHandoff(undefined)}
                onDispatch={dispatchHandoff}
              />
            ) : (
              <LatexAssistant
                result={compileResult}
                focusTitle={activeNode.title}
                compiling={compiling}
                onClose={() => setLatexAssistantOpen(false)}
                onRecompile={() => void compileLatex(compileResult?.mode ?? "focus")}
                onDispatch={dispatchLatexAssistant}
              />
            )}
            </Suspense>
            </>}
          </aside>
        )}
      </div>
      {repositoryOpen && (
        <Suspense fallback={toolLoading}>
        <RepositoryPanel
          document={document}
          pendingEdits={Object.keys(state.paragraphEdits).length}
          onSave={savePaper}
          onBeforeNavigate={prepareNavigation}
          onOpenFile={openSourceFile}
          onSavedDrafts={() => { setRepositoryOpen(false); void checkSourceFiles(); }}
          onCompiled={(result) => {
            setCompileResult(result); setCompileStale(!result.success);
            if (result.success) { setPreviewFormat("pdf"); setLastFullCompile(result); } else setLatexAssistantOpen(true);
          }}
          onActivate={(next) => { phaseOpening.current = { projectId: next.project.id }; activateDocument(next, next.project.id === document?.project.id, true); notebookStorage.recover(); setCompileStale(true); }}
          onClose={() => { navigationArchive.current = undefined; setRepositoryOpen(false); }}
        />
        </Suspense>
      )}
      {document && !repositoryOpen && state.handoffResume && <div className="handoff-return-bar"><button onClick={resumeHandoffWork}>Resume other work →</button><button aria-label="Dismiss return button" title="Your work stays saved" onClick={() => patchState({ handoffResume: undefined })}><X size={13} /></button></div>}
      {document && !repositoryOpen && <HandoffNotice waiting={waitingChats} ready={receivedTasks} onPaste={openReplyImport} onReturn={returnReadyResponse} onFinishWithoutImport={finishExternalTask}
        onHideWaiting={() => setState((current) => ({ ...current, hiddenWaitingNoticeIds: [...new Set([...(current.hiddenWaitingNoticeIds ?? []), ...waitingChats.map((task) => task.id)])].slice(-2000) }))} onDismissReady={() => setReadyReturns([])} />}
      {toast && <div className={`toast ${waitingChats.length || receivedTasks.length ? "with-handoff-notice" : ""}`}>{toast}</div>}
    </div>
  );
}
