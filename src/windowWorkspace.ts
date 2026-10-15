import type { AppState, ProjectDocument } from "./types.ts";

export type WindowPanel = "paper" | "notebook" | "preview";
export interface WindowRequest { projectId: string; panel: WindowPanel; revision: string; rootFile: string; nodeId?: string; paragraphId?: string; notebookId?: string; cellId?: string; outputIndex?: number; evidenceRevision?: string; backLink?: string; recoveryId?: string; format: "reading" | "pdf" }
export function readWindowRequest(search: string): WindowRequest | undefined {
  const q = new URLSearchParams(search), projectId = q.get("awProject"), panel = q.get("awPanel");
  if (!projectId || !["paper", "notebook", "preview"].includes(panel ?? "") || search.length > 4096) return undefined;
  return { projectId, panel: panel as WindowPanel, revision: q.get("awRevision") ?? "", rootFile: q.get("awRoot") ?? "",
    nodeId: q.get("awNode") ?? undefined, paragraphId: q.get("awParagraph") ?? undefined, notebookId: q.get("awNotebook") ?? undefined,
    cellId: /^[A-Za-z0-9_-]{1,64}$/.test(q.get("awCell") ?? "") ? q.get("awCell")! : undefined,
    outputIndex: /^(?:[0-9]|[12][0-9])$/.test(q.get("awOutput") ?? "") ? Number(q.get("awOutput")) : undefined,
    evidenceRevision: /^[a-f0-9]{64}$/.test(q.get("awEvidence") ?? "") ? q.get("awEvidence")! : undefined,
    backLink: q.get("awBack") ?? undefined,
    recoveryId: /^[a-zA-Z0-9-]{1,80}$/.test(q.get("awRecover") ?? "") ? q.get("awRecover")! : undefined,
    format: q.get("awFormat") === "reading" ? "reading" : "pdf" };
}

/** Explicit manuscript links may open their root, but never redirect recovery
 * windows, unknown roots, or an editor with unsettled source. Switching itself
 * still goes through the guarded save-before-navigation workflow. */
export function automaticLinkedManuscript(request: WindowRequest | undefined, document: ProjectDocument,
  state: Pick<AppState, "paragraphEdits" | "sourceSaveContinuation">, rawEditing = false) {
  if (!request || request.projectId !== document.project.id || request.panel === "notebook" || request.recoveryId
    || !request.rootFile || request.rootFile === document.project.mainFile || !document.rootFiles.includes(request.rootFile)
    || rawEditing || state.sourceSaveContinuation || Object.keys(state.paragraphEdits).length) return;
  return request.rootFile;
}
export function windowWorkspaceUrl(base: string, document: ProjectDocument, state: AppState, panel: WindowPanel, format: "reading" | "pdf") {
  const url = new URL(base); url.search = ""; url.hash = "";
  for (const [key, value] of Object.entries({ awProject: document.project.id, awPanel: panel, awRevision: document.revision, awRoot: document.project.mainFile,
    awNode: state.activeNodeId, awParagraph: state.activeParagraphId, awNotebook: state.activeNotebookId, awFormat: format })) if (value) url.searchParams.set(key, value);
  return url.href;
}
export function applyWindowRequest(state: AppState, document: ProjectDocument, request: WindowRequest): AppState {
  if (document.project.id !== request.projectId) return state;
  const exact = document.revision === request.revision && document.project.mainFile === request.rootFile;
  const p = exact && document.paragraphs.find(p => p.id === request.paragraphId);
  const node = p ? document.nodes.find(n => n.id === p.nodeId) : exact && document.nodes.find(n => n.id === request.nodeId);
  return { ...state, destination: request.panel === "notebook" ? "notebook" : "manuscript", activeNotebookId: request.notebookId,
    activeNodeId: node ? node.id : document.nodes[0]?.id ?? "document", activeParagraphId: p ? p.id : node ? node.paragraphIds[0] : undefined,
    focusedNodeId: undefined, hiddenNodeIds: [], blockWindow: undefined, lens: "paper", outlineCollapsed: true,
    previewMode: request.panel === "preview" ? "full" : request.panel === "paper" ? "split" : "hidden", detachedPreview: false, turbo: { ...state.turbo, enabled: false } };
}

type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "length" | "key">>;
const recoveryPrefix = "\u0001AWLZW1:";
const recoveryDictionaryLimit = 131072;
const recoveryDecodedLimit = 32_000_000;

/** Lossless UTF-16 LZW, with a bounded dictionary and two code units per code.
 * Keep raw snapshots when packing would make them bigger. Shared checkpoints
 * stay in their legacy format; only this writer's recovery copies are packed. */
export function packBrowserRecovery(raw: string): string {
  if (raw.length < 4096 || raw.length > recoveryDecodedLimit) return raw;
  const dictionary = new Map<string, number>(), parts: string[] = [];
  let next = 65536, word = raw[0];
  const emit = (value: string) => {
    const code = value.length === 1 ? value.charCodeAt(0) : dictionary.get(value)!;
    parts.push(String.fromCharCode(code >>> 16, code & 65535));
  };
  for (let i = 1; i < raw.length; i++) {
    const letter = raw[i], joined = word + letter;
    if (dictionary.has(joined)) word = joined;
    else {
      emit(word);
      if (next < recoveryDictionaryLimit) dictionary.set(joined, next++);
      word = letter;
    }
  }
  emit(word);
  const packed = recoveryPrefix + parts.join("");
  return packed.length + 32 < raw.length ? packed : raw;
}

export function unpackBrowserRecovery(raw: string): string {
  if (!raw.startsWith(recoveryPrefix)) return raw; // Existing browser records.
  const payload = raw.slice(recoveryPrefix.length);
  if (!payload.length || payload.length % 2) throw new Error("Invalid browser recovery encoding.");
  const dictionary = new Map<number, string>(), parts: string[] = [];
  let next = 65536, previous = "", length = 0;
  for (let i = 0; i < payload.length; i += 2) {
    const code = payload.charCodeAt(i) * 65536 + payload.charCodeAt(i + 1);
    const word = code < 65536 ? String.fromCharCode(code) : dictionary.get(code)
      ?? (previous && code === next && next < recoveryDictionaryLimit ? previous + previous[0] : undefined);
    if (word === undefined || code >= recoveryDictionaryLimit) throw new Error("Invalid browser recovery encoding.");
    length += word.length;
    if (length > recoveryDecodedLimit) throw new Error("Browser recovery exceeds its decoded size limit.");
    parts.push(word);
    if (previous && next < recoveryDictionaryLimit) dictionary.set(next++, previous + word[0]);
    previous = word;
  }
  return parts.join("");
}

function readRecovery(storage: CacheStorage, key: string) {
  const raw = storage.getItem(key);
  return raw === null ? null : unpackBrowserRecovery(raw);
}

function writeRecovery(storage: CacheStorage, key: string, value: string, area: "local" | "session") {
  try { storage.setItem(key, value); }
  catch (cause) {
    const name = cause && typeof cause === "object" && "name" in cause ? String(cause.name) : "Error";
    throw Object.assign(new Error("Browser recovery write failed.", { cause }), { name, recoveryStorage: { area, characters: value.length } });
  }
}
/** Old experiment recoveries duplicated the full disk notebook even with no
 * edits. Reclaim only exact base==notebook copies for this owner's cache; keep
 * every dirty/malformed/unknown record, pointer and saved timestamp intact. */
export function compactSavedExperimentRecoveries(storage: CacheStorage, key: string) {
  if (!/^paperfocus:experiments:[^:]+:[^:]+:drafts\.v2$/.test(key) || !storage.key || storage.length === undefined) return;
  const names = [key, key.replace(/:drafts\.v2$/, ""), `${key}.window`, ...Array.from({ length: storage.length }, (_, i) => storage.key!(i))
    .filter((name): name is string => Boolean(name?.startsWith(`${key}.window.`) && /^[a-zA-Z0-9-]{1,80}$/.test(name.slice(`${key}.window.`.length))))];
  for (const name of names) {
    try {
      const raw = storage.getItem(name); if (!raw || raw === "{}") continue;
      const value = JSON.parse(unpackBrowserRecovery(raw));
      if (value?.base && value?.notebook && Object.keys(value).sort().join(",") === "base,notebook"
        && value.base.nbformat === 4 && Array.isArray(value.base.cells) && Array.isArray(value.notebook.cells)
        && JSON.stringify(value.base) === JSON.stringify(value.notebook)) storage.setItem(name, "{}");
    } catch { /* A questionable recovery is never removed to make room. */ }
  }
}

/** On quota failure, reclaim provably clean notebook duplicates, including
 * legacy and tab-local copies. Never evict drafts, unknown schemas or views. */
export function compactBrowserExperimentRecoveries(storage: CacheStorage) {
  if (!storage.key || storage.length === undefined) return;
  const owners = new Set<string>();
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i) ?? "";
    const match = /^(paperfocus:experiments:[^:]+:[^:]+):drafts\.v2(?:\.window(?:\.[a-zA-Z0-9-]{1,80})?)?$/.exec(name)
      ?? /^(paperfocus:experiments:[^:]+:[^:]+)$/.exec(name);
    if (match) owners.add(`${match[1]}:drafts.v2`);
  }
  for (const key of owners) compactSavedExperimentRecoveries(storage, key);
}

/** Losslessly shrink retained, inactive window copies on quota failure. Never
 * rewrite an active/recent writer, a shared checkpoint or an unknown record. */
export function packInactiveBrowserRecoveries(storage: CacheStorage, now = Date.now()) {
  if (!storage.key || storage.length === undefined) return;
  const names = Array.from({ length: storage.length }, (_, i) => storage.key!(i));
  for (const name of names) {
    if (!name) continue;
    const match = /^(?:paperfocus\.prototype\.v1(?:\.[a-zA-Z0-9-]+)?|active-writing\.(?:raw\.v2|command)\..+|paperfocus:experiments:[^:]+:[^:]+:drafts\.v2)\.window\.([a-zA-Z0-9-]{1,80})$/.exec(name);
    if (!match) continue;
    const leaseKey = `active-writing.window.${match[1]}.alive`;
    const inactive = () => {
      const lease = storage.getItem(leaseKey), saved = storage.getItem(`${name}.savedAt`);
      // Missing timestamps from legacy records are allowed; invalid/future ones aren't.
      return [lease, saved].every(value => value === null || Number.isFinite(Number(value)) && now - Number(value) >= 180_000);
    };
    try {
      if (!inactive()) continue;
      const raw = storage.getItem(name);
      if (!raw || raw.startsWith(recoveryPrefix)) continue;
      const value = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const known = name.startsWith("paperfocus.prototype.v1")
        ? value.paragraphEdits && typeof value.paragraphEdits === "object" && Array.isArray(value.notebookEntries)
        : name.startsWith("paperfocus:experiments:") ? value.base && value.notebook
        : typeof value.draft === "string" && (typeof value.source === "string" || typeof value.original === "string");
      if (!known) continue;
      const packed = packBrowserRecovery(raw);
      // Check again after encoding; another window may have saved in between.
      if (packed !== raw && inactive() && storage.getItem(name) === raw) storage.setItem(name, packed);
    } catch { /* Preserve malformed/blocked records; never delete for quota. */ }
  }
}

/** A clean notebook is already authoritative on disk, not a browser draft. */
export function experimentRecoverySnapshot(base: unknown, notebook: unknown, serialize: (value: object) => string) {
  return serialize(base as object) === serialize(notebook as object) ? "{}" : serialize({ base, notebook });
}
/** Window-local recovery first; the shared checkpoint never lends another live window's draft. */
export function createWindowStateCache(local: CacheStorage, session: CacheStorage, windowId: string, now = () => Date.now()) {
  const leaseKey = `active-writing.window.${windowId}.alive`;
  let departed = false;
  const touch = () => { departed = false; writeRecovery(local, leaseKey, String(now()), "local"); };
  const alive = (id: string) => { const raw = local.getItem(`active-writing.window.${id}.alive`); return raw !== null && now() - Number(raw) < 180_000; };
  const writeSnapshot = (key: string, serialized: string, checkpoint: string) => {
    // Also repairs old redundant copies when opening their owning notebook.
    if (serialized === "{}") compactSavedExperimentRecoveries(local, key);
    // Publish a pointer only after this window's complete recovery copy exists.
    const packed = packBrowserRecovery(serialized);
    writeRecovery(session, `${key}.window`, packed, "session");
    writeRecovery(local, `${key}.window.${windowId}`, packed, "local");
    writeRecovery(local, `${key}.window.${windowId}.savedAt`, String(now()), "local"); if (!departed) touch();
    try { writeRecovery(local, key, checkpoint, "local"); }
    catch (error) { if (error && typeof error === "object") Object.assign(error, { recoveryStage: "checkpoint" }); throw error; }
    writeRecovery(local, `${key}.owner`, windowId, "local");
  };
  return {
    touch, release: () => { departed = true; local.removeItem(leaseKey); },
    writeSnapshot,
    clearOwn(key: string) {
      session.removeItem(`${key}.window`); local.removeItem(`${key}.window.${windowId}`);
      // The clean shared checkpoint remains; other windows' recoveries are untouched.
    },
    hasOwn: (key: string) => session.getItem(`${key}.window`) !== null,
    read(key: string, fresh = false, recoveryId?: string) {
      const own = readRecovery(session, `${key}.window`); if (own) return own;
      if (recoveryId && /^[a-zA-Z0-9-]{1,80}$/.test(recoveryId)) {
        const recovered = readRecovery(local, `${key}.window.${recoveryId}`); if (recovered) return recovered;
      }
      const checkpoint = readRecovery(local, key), owner = local.getItem(`${key}.owner`);
      if (!fresh && owner && !alive(owner)) return readRecovery(local, `${key}.window.${owner}`) ?? checkpoint;
      return checkpoint;
    },
    write(key: string, state: AppState, serialized: string) {
      const checkpoint = { ...state, paragraphEdits: {}, draftRevision: undefined, draftMainFile: undefined, sourceSaveContinuation: undefined,
        notebookEntries: [], attentionTasks: [], rewriteSessions: [], handoffDrafts: {}, recoveredWorkbenchDrafts: [], notebookSync: undefined, notebookRevision: undefined, workbenchSync: undefined };
      writeSnapshot(key, serialized, JSON.stringify(checkpoint));
    },
  };
}

/** Kept copies are opened in a new window, never applied over the active draft. */
export function listWindowRecoveries(storage: Pick<Storage, "length" | "key" | "getItem">, key: string, currentId: string) {
  const prefix = `${key}.window.`;
  const copies: { id: string; savedAt: number; draftCount: number; destination: string }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i); if (!name?.startsWith(prefix)) continue;
    const id = name.slice(prefix.length); if (id === currentId || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) continue;
    try {
      const state = JSON.parse(unpackBrowserRecovery(storage.getItem(name) ?? "null")) as AppState | null;
      if (!state || typeof state.paragraphEdits !== "object" || !state.paragraphEdits) continue;
      const draftCount = Object.keys(state.paragraphEdits).length;
      if (!draftCount) continue; // Saved notebook/queue content is available from the shared disk stores.
      copies.push({ id, savedAt: Number(storage.getItem(`${name}.savedAt`)) || 0, draftCount, destination: state.destination });
    } catch { /* Ignore malformed copies without deleting them. */ }
  }
  return copies.sort((a, b) => b.savedAt - a.savedAt);
}

export function resetCompanionSession(storage: Pick<Storage, "length" | "key" | "removeItem">) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) if (key === "active-writing.window.project" || key?.endsWith(".window") && /^(?:paperfocus.prototype.v1|active-writing\.(?:raw.v2|resume.v1|reading.v1)|paperfocus:experiments:)/.test(key)) storage.removeItem(key);
}
