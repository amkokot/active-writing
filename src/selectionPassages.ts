import type { NotebookSource, Paragraph, PendingSelection, RewriteSession, SelectedPassage } from "./types.ts";
import { sourceChunks } from "./sourceChunks.ts";
import { sameProtectedLatex } from "./rewrite.ts";

export const selectionLimit = 200;
export function selectionPassages(selection: Pick<PendingSelection, "paragraphId" | "nodeId" | "start" | "end" | "text" | "spans">): SelectedPassage[] {
  return selection.spans ?? [{ paragraphId: selection.paragraphId, nodeId: selection.nodeId, start: selection.start, end: selection.end, text: selection.text }];
}
export function clipSelectedChunks(paragraph: Pick<Paragraph, "id" | "nodeId" | "text">, start: number, end: number): SelectedPassage[] {
  return sourceChunks(paragraph.text).flatMap(chunk => {
    const a = Math.max(start, chunk.start), b = Math.min(end, chunk.end), text = paragraph.text.slice(a, b);
    return b > a && text.trim() ? [{ paragraphId: paragraph.id, nodeId: paragraph.nodeId, start: a, end: b, text }] : [];
  });
}
export function verifySelection(selection: PendingSelection, read: (id: string) => Pick<Paragraph, "nodeId" | "text"> | undefined) {
  const spans = selectionPassages(selection);
  if (!spans.length || spans.length > selectionLimit) throw new Error(`Select between 1 and ${selectionLimit} blocks at a time.`);
  const ranges = new Map<string, SelectedPassage[]>();
  for (const span of spans) {
    const p = read(span.paragraphId);
    if (!p || p.nodeId !== span.nodeId || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start
      || span.end > p.text.length || p.text.slice(span.start, span.end) !== span.text) throw new Error("A highlighted block changed. Select it again; your notes are kept.");
    const previous = ranges.get(span.paragraphId) ?? [];
    if (previous.some(other => span.start < other.end && span.end > other.start)) throw new Error("The selection contains overlapping blocks. Select it again.");
    previous.push(span); ranges.set(span.paragraphId, previous);
  }
  return spans;
}
export function notebookExcerpt(source?: NotebookSource) { return source?.passages?.map(p => p.excerpt).join("\n\n") ?? source?.excerpt ?? ""; }
export function notebookSurroundingSource(source?: NotebookSource) {
  if (!source?.passages) return source?.paragraphText ?? "";
  return [...new Map(source.passages.map(p => [`${p.file}:${p.paragraphId}`, p.paragraphText])).values()].join("\n\n");
}
/** One replacement per captured block. Never guess how prose crosses file/environment boundaries. */
export function selectedRewriteEdits(session: RewriteSession, candidate: string, read: (id: string) => string | undefined) {
  const spans = session.selectionSpans ?? [{ paragraphId: session.paragraphId, nodeId: session.nodeId, start: session.start, end: session.end, text: session.sourceText }];
  if (!spans.length || spans.length > selectionLimit) return { error: "This selection is invalid. Highlight the blocks again; saved alternatives are kept." };
  const replacements = session.selectionSpans ? sourceChunks(candidate).map(chunk => chunk.text) : [candidate];
  if (replacements.length !== spans.length) return { error: `Keep ${spans.length} blocks, separated by a blank line, before replacing. Nothing was changed.` };
  const edits: Record<string, string> = {}, groups = new Map<string, Array<{ span: SelectedPassage; replacement: string }>>();
  for (const [index, span] of spans.entries()) {
    const current = read(span.paragraphId);
    if (current === undefined || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || current.slice(span.start, span.end) !== span.text || span.end > current.length) return { error: "A selected block changed. Highlight it again before replacing; saved alternatives are kept." };
    if (session.selectionSpans && !sameProtectedLatex(span.text, replacements[index])) return { error: "Keep each block's math and LaTeX commands in that block. Nothing was changed." };
    const items = groups.get(span.paragraphId) ?? [];
    if (items.some(({ span: other }) => span.start < other.end && span.end > other.start)) return { error: "The selection overlaps itself. Highlight the blocks again; nothing was changed." };
    items.push({ span, replacement: replacements[index] }); groups.set(span.paragraphId, items);
  }
  for (const [id, items] of groups) {
    let text = read(id)!; items.sort((a, b) => b.span.start - a.span.start);
    for (const { span, replacement } of items) text = text.slice(0, span.start) + replacement + text.slice(span.end);
    edits[id] = text;
  }
  return { edits };
}
