import type { SaveAcknowledgement } from "../src/types.ts";
import { editableProject, saveEdits } from "./projects.ts";
import type { ParagraphJoinUndo } from "../src/sourceChunks.ts";

/** Remove a paragraph separator, never intervening commands or a file/container boundary. */
export async function joinParagraphs(workspace: string, request: { projectId: string; mainFile: string; revision: string; previousId: string; currentId: string }) {
  const before = await editableProject(workspace, request.projectId);
  if (before.project.mainFile !== request.mainFile || before.revision !== request.revision) throw new Error("The source changed. Your blocks are kept; review source changes before merging.");
  const previous = before.paragraphs.find(p => p.id === request.previousId), current = before.paragraphs.find(p => p.id === request.currentId);
  if (!previous || !current || previous.emptySource || current.emptySource || previous.nodeId !== current.nodeId || previous.file !== current.file) throw new Error("Merge only neighboring text blocks in the same section, environment and file.");
  const spans = before.spans.filter(span => span.file === previous.file).sort((a, b) => a.start - b.start), index = spans.findIndex(span => span.id === previous.id);
  if (index < 0 || spans[index + 1]?.id !== current.id) throw new Error("An intervening block must not be skipped when merging.");
  const left = spans[index], right = spans[index + 1], gap = before.sources[left.file].slice(left.end, right.start);
  if (!gap || gap.length > 64000 || gap.replace(/%[^\r\n]*/g, "").trim()) throw new Error("Commands lie between these blocks. Edit their boundary in the source editor instead.");
  const comments = gap.split(/\r?\n/).filter(line => line.trim() && !/^\s*%\s*paperfocus:paragraph=/.test(line));
  const newline = gap.includes("\r\n") ? "\r\n" : "\n";
  const replacement = comments.length ? newline + comments.join(newline) + newline : /(?<!\\)%[^\r\n]*$/.test(left.text) ? newline : " ";
  const gapId = `join-gap:${previous.id}:${current.id}`;
  // All original source ranges remain separate and unchanged. The acknowledgement
  // maps both originals into the merged block, preserving comments/evidence anchors.
  const ranges = before.spans.map(span => ({ paragraphId: span.id, file: span.file, start: span.start, end: span.end, text: span.text }));
  ranges.push({ paragraphId: gapId, file: left.file, start: left.end, end: right.start, text: gap });
  const after = await saveEdits(workspace, request.projectId, { [gapId]: replacement }, request.revision, ranges, request.mainFile);
  const acknowledgement = after.saveAcknowledgement as SaveAcknowledgement;
  const leftTarget = acknowledgement.paragraphMap[previous.id], rightTarget = acknowledgement.paragraphMap[current.id];
  const joined = leftTarget?.length === 1 && rightTarget?.length === 1 && leftTarget[0].paragraphId === rightTarget[0].paragraphId
    ? after.paragraphs.find(p => p.id === leftTarget[0].paragraphId) : undefined;
  if (!joined || joined.text !== previous.text + replacement + current.text) throw new Error("The merge saved but its navigation could not be confirmed. The backup is retained; review source changes.");
  const undo: ParagraphJoinUndo = { projectId: request.projectId, mainFile: request.mainFile, revision: after.revision,
    paragraphId: joined.id, text: joined.text, start: previous.text.length, end: previous.text.length + replacement.length, separator: gap };
  return { parsed: after, undo, caret: { paragraphId: joined.id, nodeId: joined.nodeId, offset: undo.end } };
}

/** Guarded inverse. Never undo through later source changes. */
export async function undoParagraphJoin(workspace: string, undo: ParagraphJoinUndo) {
  const before = await editableProject(workspace, undo.projectId);
  const paragraph = before.paragraphs.find(p => p.id === undo.paragraphId);
  if (before.project.mainFile !== undo.mainFile || before.revision !== undo.revision || !paragraph || paragraph.text !== undo.text
    || !Number.isSafeInteger(undo.start) || !Number.isSafeInteger(undo.end) || undo.start < 0 || undo.end < undo.start || undo.end > undo.text.length
    || typeof undo.separator !== "string" || undo.separator.length > 64000 || undo.separator.replace(/%[^\r\n]*/g, "").trim()) throw new Error("Source changed after the merge. Undo will not overwrite later edits; the backup is kept.");
  return saveEdits(workspace, undo.projectId, { [paragraph.id]: undo.text.slice(0, undo.start) + undo.separator + undo.text.slice(undo.end) }, undo.revision, undefined, undo.mainFile);
}
