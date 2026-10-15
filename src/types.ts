import type { PaperAppearance } from "./paperAppearance";
export type Lens = "paper" | "proofs" | "themes";
export type DisplayMode = "source" | "project" | "manuscript" | "editing" | "compact";
export type CompileMode = "focus" | "full";
export type PreviewMode = "hidden" | "split" | "full";
export type ManuscriptScope = "all" | "section" | "window";
export interface BlockWindow { radius: number; paragraphId?: string }
export type ProgressState = "blank" | "progress" | "done";
export type NodeKind =
  | "section"
  | "subsection"
  | "theorem"
  | "lemma"
  | "corollary"
  | "proof";

export interface ManuscriptNode {
  id: string;
  parentId?: string;
  number?: string;
  title: string;
  kind: NodeKind;
  depth: number;
  paragraphIds: string[];
  environment?: string;
  environmentTitle?: string;
  environmentCounter?: string;
  environmentNumber?: number;
  canChangeEnvironment?: boolean;
  /** View-only links; never change source ancestry or file order. */
  proofFor?: string[];
  sectionCounters?: Record<string, number>;
  sourceInsertion?: { file: string; offset: number };
  /** Literal structural commands for the unformatted source view. */
  sourceOpening?: { file: string; start: number; end: number; text: string };
  sourceClosing?: { file: string; start: number; end: number; text: string };
  sourceLastParagraphId?: string;
}

export interface Paragraph {
  id: string;
  /** Explicit source marker, not a position-derived generated ID. */
  explicitId?: boolean;
  nodeId: string;
  text: string;
  kind?: "prose" | "statement" | "proof";
  file?: string;
  renderIssue?: string;
  emptySource?: boolean;
  /** Original file's hard line number; view metadata, never source content. */
  sourceLine?: number;
}

export type ManuscriptPurpose = "notes" | "overview" | "publication";
export interface PaperProject {
  id: string;
  name: string;
  folder: string;
  mainFile: string;
  engine?: "pdflatex" | "xelatex" | "lualatex";
  createdAt: string;
  lastOpenedAt?: string;
  lastActivityAt?: string;
  manuscriptVersions?: ManuscriptVersion[];
  /** Aw-only policy, keyed by independent TeX root. Unmarked roots are research notes. */
  manuscriptPurposes?: Record<string, ManuscriptPurpose>;
  /** Collaborator overview -> independent main manuscript root, not an include. */
  manuscriptOverviewTargets?: Record<string, string>;
}

export interface ManuscriptVersion {
  file: string; family: string; number: number; createdAt: string;
  previousFile?: string; notebook: "continue" | "fresh";
}

export interface ProjectDocument {
  project: PaperProject;
  files: string[];
  rootFiles: string[];
  nodes: ManuscriptNode[];
  paragraphs: Paragraph[];
  revision: string;
  labels?: DocumentLabel[];
  citations?: CitationEntry[];
  sourceFiles?: string[];
  appearance?: PaperAppearance;
  /** Source remains editable even while an unfinished root cannot be parsed. */
  structureIssue?: string;
  /** Literal theorem declarations from this project's preamble, plus available proof. */
  environmentOptions?: Array<{ name: string; title: string }>;
}

/** Exact source-offset correspondence from an acknowledged editor save, never a fuzzy match. */
export interface SaveAcknowledgement {
  baseRevision: string;
  savedRevision: string;
  paragraphMap: Record<string, Array<{ paragraphId: string; start: number; end: number; targetStart?: number }>>;
  sourceRanges: SourceEditRange[];
}

export interface SourceEditRange { paragraphId: string; file: string; start: number; end: number; text: string }
export interface SourceSaveContinuation { document: ProjectDocument; ranges: SourceEditRange[] }

export interface DocumentLabel {
  key: string;
  nodeId: string;
  paragraphId?: string;
  file: string;
  line: number;
}

export interface CitationEntry {
  key: string;
  title?: string;
  author?: string;
  year?: string;
  url?: string;
  doi?: string;
  arxivId?: string;
  file?: string;
  bibliographyFile?: string;
}

export interface ReferenceToken {
  kind: "label" | "citation" | "url";
  keys: string[];
  start: number;
  end: number;
  raw: string;
  locator?: string;
}

export interface ReferenceRequest {
  token: ReferenceToken;
  paragraphId?: string;
  inspect?: boolean;
}

export interface ReferenceCopy {
  filename: string;
  name: string;
  pages: Record<string, number>;
}

export interface RepoRemote {
  name: string;
  url: string;
  provider: "github" | "overleaf" | "git";
  ahead?: number;
  behind?: number;
  branch?: string;
}
export interface RepoStatus {
  initialized: boolean;
  branch?: string;
  ahead: number;
  behind: number;
  remotes: RepoRemote[];
  changes: Array<{ path: string; status: string }>;
  conflicts: string[];
  fullVerified: boolean;
}

export interface RepositoryAccount {
  installed: boolean;
  authenticated: boolean;
  login?: string;
  message?: string;
}

export type RewriteRoute = "rules" | "local" | "codex" | "chatgpt";

export interface RewriteCandidate {
  id: string;
  text: string;
  source: string;
  dismissed: boolean;
  userEdited: boolean;
}

export interface RewriteSession {
  id: string;
  paragraphId: string;
  nodeId: string;
  start: number;
  end: number;
  sourceText: string;
  selectionSpans?: SelectedPassage[];
  sourceFingerprint: string;
  beforeAnchor: string;
  afterAnchor: string;
  instruction: string;
  route: RewriteRoute;
  effortByRoute: Record<RewriteRoute, number>;
  localModel?: string;
  candidates: RewriteCandidate[];
  selectedCandidateId?: string;
  status: "draft" | "stale" | "applied" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ThemeMatch {
  paragraphId: string;
  score: number;
  pinned?: boolean;
  excluded?: boolean;
}

export interface ThemeLens {
  id: string;
  name: string;
  seedParagraphId: string;
  matches: ThemeMatch[];
  drafts?: ThemeDraft[];
  composerText?: string;
}

export interface ThemeDraft {
  id: string;
  text: string;
  targetNodeId?: string;
  createdAt: string;
}

export interface QueueMetadata { queuePosition?: number; queueOrderedAt?: string; deferredAt?: string; queueColorResetAt?: string; queueHiddenAt?: string }
export interface AttentionTask extends QueueMetadata {
  id: string;
  title: string;
  sessionId?: string;
  /** Explicit user order; absent until the queue is rearranged. */
  queuePosition?: number;
  queueOrderedAt?: string;
  /** Left this task while waiting; a reminder, never proof of external completion. */
  deferredAt?: string;
  notebookId?: string;
  studyTurnId?: string;
  previousTaskId?: string;
  handoffPath?: string;
  packet?: string;
  sourceSnapshot?: TaskSourceSnapshot;
  ticket?: HandoffTicket;
  reply?: string;
  replyDraft?: string;
  authorEditedReply?: boolean;
  localJobId?: string;
  /** Retained legacy metadata only; direct subscription integration has been removed. */
  subscriptionJobId?: string;
  error?: string;
  turbo?: boolean;
  nodeId: string;
  paragraphId?: string;
  route: Exclude<RewriteRoute, "rules">;
  status: "queued" | "working" | "ready" | "failed" | "reviewed";
  /** Queue retirement is reversible; it is not a correctness judgment. */
  archivedStatus?: Exclude<AttentionTask["status"], "reviewed">;
  /** User finished in another app; no answer was imported or judged verified. */
  completedExternally?: boolean;
  createdAt: string;
  updatedAt: string;
  review?: ReviewComment | ReviewRequest;
  /** Small writing rounds. An assistant reply never records human approval. */
  writing?: WritingRequest | WritingParagraph;
  /** Human bookmarks and explicit unfinished-section reminders, never model jobs. */
  reminder?: { kind: "passage"; start: number; end: number; quote: string; wholeBlock?: boolean } | { kind: "section" };
}

export type WritingScope = "paragraph" | "section" | "theme" | "paper";
export interface WritingRequest {
  kind: "request";
  instruction: string;
  scope: WritingScope;
  themeName?: string;
  previousRoundId?: string;
  lockedParagraphIds?: string[];
  settledNotes?: string;
  connection?: string;
  nextStep?: string;
}
export interface WritingParagraph {
  kind: "paragraph";
  roundId: string;
  externalId: string;
  action: "replace" | "before" | "after";
  purpose: string;
  rationale: string;
  proposedText: string;
  draftText: string;
  /** Draft text may be in the manuscript without being approved. */
  placement?: { text: string; before: string; createdAt: string };
  decision?: "accepted" | "dropped";
  curatedText?: string;
  decidedAt?: string;
  /** Deliberate human reopening, never supplied by an assistant reply. */
  unlockedAt?: string;
  feedback?: string;
}

export interface ReviewComment {
  kind: "comment";
  author: "human" | "assistant";
  body: string;
  start: number;
  end: number;
  quote: string;
  resolvedAt?: string;
  editedByHuman?: boolean;
  batchId?: string;
  externalId?: string;
  replyTo?: string;
}
export interface ReviewRequest {
  kind: "request";
  mode: "human" | "ai";
  instructions: string;
  commentIds: string[];
  instructionsPath?: string;
  webPath?: string;
  completedPath?: string;
}

export interface TurboReview {
  fingerprint: string;
  checkedAt: string;
  reason: "next" | "scroll" | "reply" | "manual";
}

export interface TurboState {
  enabled: boolean;
  activeParagraphId?: string;
  context: number;
  autoCheck: boolean;
  includeTechnical: boolean;
  atEnd: boolean;
  reviews: Record<string, TurboReview>;
  history: Array<{ paragraphId: string; previous?: TurboReview }>;
  returnView?: { lens: Lens; activeNodeId: string; focusedNodeId?: string; previewMode: PreviewMode; blockWindow?: BlockWindow };
  reviewingTaskId?: string;
  resumeParagraphId?: string;
  pendingPrompt?: { paragraphId: string; nodeId: string; start: number; end: number; text: string };
}

export interface AppState {
  destination: "manuscript" | "notebook";
  notebookEntries: NotebookEntry[];
  notebookRevision?: number;
  notebookSync?: { revision: number; fields: Record<string, string> };
  workbenchSync?: WorkbenchSync;
  /** Actual human project activity, never model polling or response arrival. */
  queueLastActiveAt?: string;
  recoveredWorkbenchDrafts?: WorkbenchRecovery[];
  activeNotebookId?: string;
  /** Browser-only disclosure state; conversations and pins are saved on disk. */
  collapsedNotebookIds?: string[];
  manuscriptPromptId?: string;
  outlineCollapsed?: boolean;
  notebookIndexVisible?: boolean;
  suggestions: { relation: "related" | "unrelated"; minimized: boolean };
  handoffResume?: Pick<AppState, "destination" | "activeNotebookId" | "activeNodeId" | "activeParagraphId" | "focusedNodeId" | "lens" | "previewMode" | "turbo" | "blockWindow"> & { hiddenNodeIds?: string[]; studyTurnId?: string };
  /** Per-paper browser view preference, not an archived/cancelled task. */
  hiddenWaitingNoticeIds?: string[];
  turbo: TurboState;
  lens: Lens;
  displayMode: DisplayMode;
  /** Box-free source is the default; block tools and structure stay available. */
  sourcePresentation?: "plain" | "blocks";
  activeNodeId: string;
  activeParagraphId?: string;
  focusedNodeId?: string;
  /** Reading/editing window only; navigation never changes review progress. */
  blockWindow?: BlockWindow;
  hiddenNodeIds: string[];
  collapsedNodeIds?: string[];
  handoffDrafts?: Record<string, HandoffDraft>;
  progressByNode: Record<string, ProgressState>;
  paragraphEdits: Record<string, string>;
  draftRevision?: string;
  /** Root ownership prevents another window's main-file change from misapplying a draft. */
  draftMainFile?: string;
  /** Saved raw regions retain ownership when typing crosses a structural save. */
  sourceSaveContinuation?: SourceSaveContinuation;
  rewriteSessions: RewriteSession[];
  attentionTasks: AttentionTask[];
  themeLenses: ThemeLens[];
  activeThemeId: string;
  previewMode: PreviewMode;
  detachedPreview?: boolean;
}

export interface HandoffDraft {
  effort: number;
  scope: "paragraph" | "section" | "none" | "auto";
  includeProject: boolean;
  instruction: string;
  label?: string;
  contextMode?: "continuation" | "briefing";
  previousTaskId?: string;
}

/** Exact exported-source baseline, not evidence of a model's memory or mathematical validity. */
export interface TaskSourceSnapshot {
  version: 1;
  projectId: string;
  revision: string;
  rootFile: string;
  scope: "paragraph" | "section";
  nodeId: string;
  nodeTitle: string;
  focusParagraphId?: string;
  paragraphs: Array<Pick<Paragraph, "id" | "nodeId" | "file" | "text"> & { command?: "opening" | "closing"; nodeTitle?: string; locationUnverified?: boolean; duplicateAtCapture?: boolean; nodeParagraphCount?: number }>;
  unavailableReason?: "oversized";
  /** Legacy whole-snapshot uncertainty; new snapshots mark only affected paragraphs. */
  locationUnverified?: boolean;
  /** Confirmed own-save navigation; never replaces the outgoing snapshot. */
  returnAnchor?: SourceReturnAnchor;
}

/** Only editor assistance records: never manuscript source or Notebook records. */
export interface WorkbenchData {
  queueLastActiveAt?: string;
  attentionTasks: AttentionTask[];
  rewriteSessions: RewriteSession[];
  handoffDrafts: Record<string, HandoffDraft>;
  recoveredDrafts: WorkbenchRecovery[];
}
export interface WorkbenchStore extends WorkbenchData { version: 1; revision: number }
export interface WorkbenchSync {
  revision: number;
  records: Record<string, string>;
}
export type WorkbenchRecovery = { id: string; key: string; createdAt: string; dismissed?: boolean } & (
  { kind: "task"; value: AttentionTask } |
  { kind: "rewrite"; value: RewriteSession } |
  { kind: "handoff"; value: HandoffDraft }
);

/** A provider-neutral exchange, not an account connection. */
export interface HandoffTicket {
  id: string;
  transport: "paste" | "files";
  label: string;
  promptPath: string;
  responsePath: string;
  requestHash: string;
  copyText: string;
  replyHash?: string;
  /** Folder-aware research writes cells directly; no response file is needed. */
  notebookTarget?: { entryId: string; notebookId: string };
}
export interface HandoffSettings {
  transport: "paste" | "files";
  label: string;
  contextMode: "continuation" | "briefing";
}

export interface NotebookSource {
  /** Parent manuscript ownership; older captures may not know their root. */
  rootFile?: string;
  paragraphId: string;
  nodeId: string;
  nodeTitle: string;
  file?: string;
  revision: string;
  paragraphText: string;
  duplicateAtCapture?: boolean;
  start: number;
  end: number;
  excerpt: string;
  passages?: Array<Omit<NotebookSource, "passages">>;
  /** Navigation after an applied expansion; never authorizes editing a partial span. */
  returnAnchor?: SourceReturnAnchor;
}

export interface SourceReturnAnchor {
  rootFile?: string;
  paragraphId: string; paragraphText: string; file?: string; revision: string; duplicateAtCapture?: boolean;
  /** Exact quoted range after a split, if the quote remains in one chunk. */
  start?: number; end?: number;
}

export interface NotebookEntry {
  id: string;
  /** Catalogue scope; absent legacy entries remain project-wide. */
  manuscriptFile?: string;
  continuedFrom?: { entryId: string; notebookId: string; manuscriptFile: string; revision: string };
  title: string;
  question: string;
  notes: string;
  reply: string;
  proposal: string;
  experimentContext?: string;
  /** Keep this conversation open when selecting another one. */
  pinned?: boolean;
  pinMode?: "conversation" | "experiments";
  /** Catalogue only: never closes a request or deletes its experiments. */
  filed?: boolean;
  folder?: string;
  cataloguePosition?: number;
  experimentNotebookId?: string;
  recoveryKey?: string;
  source?: NotebookSource;
  returnView?: { lens: Lens; focusedNodeId?: string; previewMode: PreviewMode; turboEnabled: boolean; turboCursor?: string; blockWindow?: BlockWindow };
  status: "open" | "parked" | "integrated";
  route: "local" | "chatgpt" | "codex";
  effort: number;
  study?: NotebookStudy;
  handoffs: Array<{ id: string; packet: string; createdAt: string; studyTurnId?: string; historyOnly?: boolean } & QueueMetadata>;
  appliedChanges: Array<{ before: string; after: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}

export type StudyAction = "explain" | "catchup" | "step" | "assumptions" | "develop" | "references";
export type StudyDepth = "intuition" | "example" | "derivation";
export type StudyGuidance = "hint" | "outline" | "walkthrough";
export interface StudyBenchmark {
  statement: string; citationKey: string; locator: string;
  phase: "attempt" | "compare"; referenceNotes: string;
  checkpoint?: { statement: string; question: string; notes: string; findings: string; createdAt: string };
}
export interface StudyFocus { text: string; origin: string }
export interface StudyReference { title: string; why: string; locator: string; citationKey: string; url: string }
export interface StudyAnswer { idea: string; background: string; argument: string; checks: string; references: StudyReference[] }
export interface StudyTurn extends QueueMetadata {
  id: string; action: StudyAction; depth: StudyDepth; focus?: StudyFocus;
  effort?: number;
  guidance?: StudyGuidance;
  route: NotebookEntry["route"]; model?: string; jobId?: string;
  ticket?: HandoffTicket;
  handoffSnapshot?: string;
  /** Retained legacy metadata only; never dispatched or resumed. */
  subscriptionJobId?: string; reasoningEffort?: string; partialReply?: string;
  packet: string; reply: string; answer?: StudyAnswer; error?: string;
  secondLookRequested?: boolean;
  secondLook?: import("./localReview.ts").LocalSecondLook;
  previousTurnId?: string;
  notebookResult?: { requestHash: string; notebookRevision: string; summaryCellId: string; completedAt: string };
  status: "queued" | "ready" | "failed"; closed?: boolean; completedExternally?: boolean; createdAt: string;
}
export interface NotebookStudy {
  mode: "understand" | "develop"; depth: StudyDepth; action: StudyAction;
  background: string; focus?: StudyFocus; localModel?: string; localEffort: number; evidenceScope?: "compact" | "expanded";
  guidance?: StudyGuidance; benchmark?: StudyBenchmark;
  secondLook?: boolean;
  handoff?: HandoffSettings;
  /** Legacy saved settings accepted for lossless recovery, not active connection settings. */
  delivery?: "integrated" | "manual"; remoteModel?: string; remoteEffort?: string;
  turns: StudyTurn[]; activeTurnId?: string;
}

export interface NotebookStore { version: 1; revision: number; entries: NotebookEntry[] }

export interface SelectedPassage {
  paragraphId: string;
  nodeId: string;
  start: number;
  end: number;
  text: string;
}
export interface PendingSelection extends SelectedPassage {
  x: number;
  y: number;
  spans?: SelectedPassage[];
}

export interface CompileResult {
  mode: CompileMode;
  success: boolean;
  pdfUrl?: string;
  durationMs: number;
  compiledAt: string;
  log: string;
  pageHint?: number;
  stale?: boolean;
  diagnostics?: LatexDiagnostic[];
  sourceRevision?: string;
  mainFile?: string;
  engine?: PaperProject["engine"];
  viewNote?: string;
  unavailablePdfDestinations?: string[];
  scope?: { focusNodeId?: string; lens?: Lens; hiddenNodeIds?: string[]; paragraphIds?: string[] };
  artifactKey?: string;
  cacheHit?: boolean;
  requestedAt?: string;
  originalPages?: number[];
}

export interface PreviewLocation { paragraphId?: string; page?: number; x?: number; y?: number; sequence: number; edge?: "start" | "end" }

export interface CompileStatus extends CompileResult {
  fullVerified?: boolean;
  fullCompile?: CompileResult;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface LatexDiagnostic {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  message: string;
  code: string;
  line?: number;
  file?: string;
  excerpt?: string;
  suggestions: string[];
}

export type LatexAssistRoute = "rules" | "local" | "chatgpt" | "codex";
