import { reelCandidate } from "./blockReel.ts";

export interface SourceViewportPosition {
  nodeId: string;
  paragraphId: string;
  viewportOffset: number;
}
export interface SourceJumpTarget {
  nodeId: string;
  paragraphId?: string;
  sequence: number;
  viewportOffset?: number;
  sourceOffset?: number;
  edge?: "start" | "end";
  flash?: boolean;
  command?: "opening" | "closing";
}

/** The visible caret wins; an offscreen old caret must not override reading. */
export function viewportParagraph(boxes: Array<{ id: string; top: number; bottom: number }>, height: number, caretId?: string) {
  const visible = boxes.filter(box => box.bottom > 0 && box.top < height);
  return visible.find(box => box.id === caretId)?.id ?? reelCandidate(visible, height / 2);
}

export function captureSourceViewport(pane: HTMLElement | null): SourceViewportPosition | undefined {
  if (!pane || !pane.clientHeight || !pane.getClientRects().length) return;
  const frame = pane.getBoundingClientRect();
  const elements = [...pane.querySelectorAll<HTMLElement>('p[data-paragraph-id]')].filter(element => element.getClientRects().length && !element.closest('[data-reel-held="true"]'));
  const selection = pane.ownerDocument.defaultView?.getSelection();
  const selected = selection?.focusNode?.nodeType === 1 ? selection.focusNode as Element : selection?.focusNode?.parentElement;
  const caret = selected?.closest<HTMLElement>('p[data-paragraph-id]');
  const boxes = elements.map(element => { const rect = element.getBoundingClientRect(); return { id: element.dataset.paragraphId!, top: rect.top - frame.top, bottom: rect.bottom - frame.top }; });
  const id = viewportParagraph(boxes, pane.clientHeight, caret && pane.contains(caret) ? caret.dataset.paragraphId : undefined);
  const element = elements.find(element => element.dataset.paragraphId === id), box = boxes.find(box => box.id === id);
  return element?.dataset.nodeId && box ? { nodeId: element.dataset.nodeId, paragraphId: box.id, viewportOffset: box.top } : undefined;
}

export function anchoredScrollTop(scrollTop: number, targetTop: number, paneTop: number, viewportOffset: number) {
  return Math.max(0, scrollTop + targetTop - paneTop - viewportOffset);
}
