import { sourceChunks } from "./sourceChunks.ts";

// textContent loses Enter-created BR/DIV line breaks; innerText collapses
// untouched source whitespace. Preserve text nodes exactly and serialize only
// the editor's explicit line-break structure.
export function editableText(root: Node): string {
  if (root.nodeType === 3) return root.textContent ?? "";
  if ((root as Element).tagName === "BR") return (root as Element).getAttribute?.("data-editor-placeholder") === "true" ? "" : "\n";
  // Deleting the last character can replace a chunk's content with a native
  // placeholder BR. It is not a source newline. Our real Enter is painted with
  // text nodes and an explicitly marked trailing placeholder.
  const children = Array.from(root.childNodes);
  const meaningful = children.filter(node => node.nodeType !== 3 || Boolean(node.textContent));
  if ((root as Element).matches?.(".source-chunks, .source-chunk") && meaningful.length === 1 && (meaningful[0] as Element).tagName === "BR" && (meaningful[0] as Element).getAttribute?.("data-source-break") !== "true") return "";
  let result = "";
  let previousBlock = false;
  for (const child of Array.from(root.childNodes)) {
    const block = ["DIV", "P"].includes((child as Element).tagName ?? "");
    if (block && (result || previousBlock) && (previousBlock || !result.endsWith("\n"))) result += "\n";
    const children = Array.from(child.childNodes);
    const emptyLine = block && children.length === 1 && (children[0] as Element).tagName === "BR";
    result += emptyLine ? "" : editableText(child);
    previousBlock = block;
  }
  return result;
}

const deletionSegments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** A literal deletion: no browser-created BRs, block merging or math rewriting. */
export function deleteSourceText(text: string, start: number, end: number, direction: "backward" | "forward") {
  start = Math.max(0, Math.min(start, text.length)); end = Math.max(start, Math.min(end, text.length));
  if (start === end) {
    const segment = deletionSegments.segment(text).containing(direction === "backward" ? start - 1 : start);
    if (!segment) return { text, caret: start };
    if (direction === "backward") start = segment.index;
    else end = segment.index + segment.segment.length;
  }
  return { text: text.slice(0, start) + text.slice(end), caret: start };
}

/** Read the browser caret without assuming that editable prose has one text node. */
export function editableCaret(root: HTMLElement): number | undefined {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection?.isCollapsed || !selection.focusNode || !root.contains(selection.focusNode)) return undefined;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root); range.setEnd(selection.focusNode, selection.focusOffset);
  return editableText(range.cloneContents()).length;
}

export function editableRangeAt(root: HTMLElement, offset: number) {
  const doc = root.ownerDocument;
  const last = root.lastChild;
  if (offset >= editableText(root).length && last instanceof Element && last.matches(".source-chunk[data-empty=true]")) {
    const range = doc.createRange(); range.setStart(last, 0); range.collapse(true); return range;
  }
  // Explicit BRs make a trailing single newline a usable caret position. A
  // browser-only placeholder keeps that line visible without adding source.
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => node.nodeType === 3 || (node as Element).tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  let node = walker.nextNode(), remaining = Math.max(0, offset);
  const range = doc.createRange();
  while (node) {
    const length = editableText(node).length;
    if (remaining <= length && (node.nodeType === 3 || length > 0)) break;
    remaining -= length; node = walker.nextNode();
  }
  if (node?.nodeType === 3) range.setStart(node, Math.min(remaining, node.textContent?.length ?? 0));
  else if (node) { if (remaining) range.setStartAfter(node); else range.setStartBefore(node); }
  else { range.selectNodeContents(root); range.collapse(false); }
  range.collapse(true); return range;
}
export function restoreEditableCaret(root: HTMLElement, offset: number) {
  const range = editableRangeAt(root,offset), selection = root.ownerDocument.defaultView?.getSelection();
  selection?.removeAllRanges(); selection?.addRange(range);
}
/** Map a caret in an acknowledged prose expansion to the newly parsed paragraph. */
export function splitEditCaret(text: string, firstParagraph: string, offset: number) {
  const parts: Array<{ text: string; start: number }> = [];
  // Explicit separator positions preserve whitespace offsets (trim only parsed prose).
  for (const chunk of sourceChunks(text)) {
    const raw = chunk.text; if (raw.trim()) parts.push({ text: raw.trim(), start: chunk.start + raw.length - raw.trimStart().length });
  }
  if (parts.length < 2 || parts[0].text !== firstParagraph) return undefined;
  let index = 0; for (let i = 1; i < parts.length; i++) if (offset >= parts[i].start) index = i;
  return { parts: parts.map(part => part.text), index, offset: Math.max(0, Math.min(parts[index].text.length, offset - parts[index].start)) };
}
