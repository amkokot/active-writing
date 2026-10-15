import type { AppState, NotebookSource, ProjectDocument, SaveAcknowledgement, SourceReturnAnchor } from "./types.ts";

export function validateReturnAnchor(value: unknown): asserts value is SourceReturnAnchor {
  const a = value as SourceReturnAnchor;
  if (!a || ["paragraphId", "paragraphText", "revision"].some(key => typeof (a as any)[key] !== "string") || a.paragraphText.length > 100000 || (a.file !== undefined && typeof a.file !== "string") || (a.duplicateAtCapture !== undefined && typeof a.duplicateAtCapture !== "boolean")
    || (a.start !== undefined || a.end !== undefined) && (!Number.isSafeInteger(a.start) || !Number.isSafeInteger(a.end) || a.start! < 0 || a.end! < a.start! || a.end! > a.paragraphText.length)) throw new Error("Invalid navigation anchor.");
}

export function locateReturnAnchor(anchor: SourceReturnAnchor | undefined, document: ProjectDocument, edits: Record<string, string> = {}) {
  if (!anchor || anchor.rootFile && anchor.rootFile !== document.project.mainFile) return undefined;
  const same = (p: ProjectDocument["paragraphs"][number]) => p.file === anchor.file && (edits[p.id] ?? p.text) === anchor.paragraphText;
  const atId = document.paragraphs.find(p => p.id === anchor.paragraphId && same(p));
  if (anchor.revision === document.revision && atId) return atId;
  if (anchor.duplicateAtCapture) return undefined;
  const exact = document.paragraphs.filter(same); return exact.length === 1 ? exact[0] : undefined;
}

/** Unknown/changed note ranges protect their owning region, never another ID. */
export function emptyChunkHasContext(state: AppState, document: ProjectDocument, paragraphId: string, text: string, start: number, end: number) {
  const intersects = (source: SourceReturnAnchor, a: number | undefined, b: number | undefined, quote: string) => {
    if (source.revision !== document.revision || source.paragraphId !== paragraphId) return false;
    if (a === undefined || b === undefined || text.slice(a, b) !== quote) return true;
    return a <= end && b >= start;
  };
  return state.notebookEntries.some(entry => {
    const source = entry.source; if (!source) return false;
    return (source.passages ?? [source]).some(p => {
      const a = p.returnAnchor;
      return intersects(a ?? p, a ? a.start : p.start, a ? a.end : p.end, p.excerpt);
    });
  }) || state.attentionTasks.some(task => {
    const source = task.sourceSnapshot;
    if (!source || source.projectId !== document.project.id || source.rootFile !== document.project.mainFile) return false;
    const p = source.paragraphs.find(p => p.id === source.focusParagraphId) ?? source.paragraphs[0]; if (!p) return false;
    const anchor = source.returnAnchor;
    return intersects(anchor ?? { paragraphId: p.id, paragraphText: p.text, revision: source.revision, file: p.file },
      anchor ? anchor.start : task.review?.kind === "comment" ? task.review.start : task.reminder?.kind === "passage" ? task.reminder.start : 0,
      anchor ? anchor.end : task.review?.kind === "comment" ? task.review.end : task.reminder?.kind === "passage" ? task.reminder.end : p.text.length,
      task.review?.kind === "comment" ? task.review.quote : task.reminder?.kind === "passage" ? task.reminder.quote : p.text);
  });
}

/** Only confirmed own-save offsets update navigation. Captured quotes/context never change. */
export function anchorSavedNotes(state: AppState, before: ProjectDocument, after: ProjectDocument, submitted: Record<string, string>, ack: SaveAcknowledgement): Pick<AppState, "notebookEntries" | "attentionTasks"> {
  if (before.project.id !== after.project.id || before.project.mainFile !== after.project.mainFile || ack.baseRevision !== before.revision || ack.savedRevision !== after.revision) throw new Error("Unconfirmed note relocation.");
  const anchor = (source: Pick<NotebookSource, "paragraphId" | "paragraphText" | "revision" | "file" | "duplicateAtCapture" | "returnAnchor">, quote: string, offset: number): SourceReturnAnchor | undefined => {
    const origin = source.returnAnchor ?? source;
    // Notes made during typing refer to this revision's owned editable region,
    // which may not yet have the disk paragraph's text.
    const old = locateReturnAnchor(origin, before) ?? (origin.revision === before.revision ? before.paragraphs.find(p => p.id === origin.paragraphId && p.file === origin.file) : undefined);
    if (!old) return undefined;
    const text = submitted[old.id] ?? old.text; let start = source.returnAnchor?.start ?? offset;
    let prefix = 0, suffix = 0;
    while (prefix < Math.min(origin.paragraphText.length, text.length) && origin.paragraphText[prefix] === text[prefix]) prefix++;
    while (suffix < Math.min(origin.paragraphText.length, text.length) - prefix && origin.paragraphText[origin.paragraphText.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
    const originalQuote = origin.paragraphText.slice(start, start + quote.length) === quote;
    let mapped = originalQuote && start + quote.length <= prefix;
    if (originalQuote && start >= origin.paragraphText.length - suffix) { start += text.length - origin.paragraphText.length; mapped = true; }
    // Search only this verified region. Repeated quotes are not guessed after
    // an edit unless an unchanged prefix/suffix proves their exact offset.
    const found = quote ? text.indexOf(quote) : -1;
    const unique = found >= 0 && text.indexOf(quote, found + 1) < 0;
    const quoted = !!quote && (mapped && text.slice(start, start + quote.length) === quote || unique);
    if (quoted && !mapped) start = found;
    if (!quoted) start = Math.min(start, text.length);
    const pieces = ack.paragraphMap[old.id] ?? [];
    const piece = pieces.find(p => start >= p.start && start < p.end) ?? pieces.find(p => start <= p.start) ?? pieces.at(-1);
    const p = piece && after.paragraphs.find(p => p.id === piece.paragraphId && p.file === old.file);
    if (!p || !piece || text.slice(piece.start, piece.end) !== p.text.slice(piece.targetStart ?? 0, (piece.targetStart ?? 0) + piece.end - piece.start)) return undefined;
    const a = Math.max(0, (piece.targetStart ?? 0) + start - piece.start), b = a + quote.length;
    return { paragraphId: p.id, paragraphText: p.text, file: p.file, revision: after.revision,
      duplicateAtCapture: after.paragraphs.filter(q => q.file === p.file && q.text === p.text).length > 1,
      ...(quoted && start + quote.length <= piece.end && p.text.slice(a, b) === quote ? { start: a, end: b } : {}) };
  };
  const notebookEntries = state.notebookEntries.map(entry => {
    if (!entry.source) return entry;
    const a = anchor(entry.source, entry.source.excerpt, entry.source.start);
    const passages = entry.source.passages?.map(p => { const next = anchor(p, p.excerpt, p.start); return next ? { ...p, returnAnchor: next } : p; });
    return a || passages ? { ...entry, source: { ...entry.source, ...(a ? { returnAnchor: a } : {}), ...(passages ? { passages } : {}) } } : entry;
  });
  const attentionTasks = state.attentionTasks.map(task => {
    const source = task.sourceSnapshot;
    if (!source || source.locationUnverified || source.projectId !== before.project.id || source.rootFile !== before.project.mainFile) return task;
    const p = source.paragraphs.find(p => p.id === source.focusParagraphId) ?? source.paragraphs[0]; if (!p || p.locationUnverified) return task;
    const range = task.review?.kind === "comment" ? task.review : task.reminder?.kind === "passage" ? task.reminder
      : task.writing?.kind === "paragraph" && task.writing.placement ? { quote: task.writing.placement.text, start: source.returnAnchor?.start ?? 0 } : undefined;
    const a = anchor({ paragraphId: p.id, paragraphText: p.text, file: p.file, revision: source.revision, duplicateAtCapture: p.duplicateAtCapture, returnAnchor: source.returnAnchor }, range?.quote ?? p.text, range?.start ?? 0);
    return a ? { ...task, sourceSnapshot: { ...source, returnAnchor: a } } : task;
  });
  return { notebookEntries: notebookEntries.every((entry, i) => entry === state.notebookEntries[i]) ? state.notebookEntries : notebookEntries,
    attentionTasks: attentionTasks.every((task, i) => task === state.attentionTasks[i]) ? state.attentionTasks : attentionTasks };
}
