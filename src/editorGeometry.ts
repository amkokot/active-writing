/** View geometry only: never a manuscript or typesetting setting. */
export function boundedPaneShare(value: number, width = 1000) {
  const edge = Math.min(0.4, Math.max(0.15, 180 / Math.max(1, width - 6)));
  return Number.isFinite(value) ? Math.max(edge, Math.min(1 - edge, value)) : 0.5;
}

export function pdfFitScale(width: number, pageWidth: number, padding = 28) {
  if (!Number.isFinite(width) || !Number.isFinite(pageWidth) || pageWidth <= 0) return 0.55;
  return Math.max(0.1, Math.min(1.4, (width - padding) / pageWidth));
}

export function resizedPdfPosition(position: { top: number; left: number; width: number; height: number; scale: number }, scale: number, width: number, height: number) {
  const ratio = scale / position.scale;
  return { top: Math.max(0, (position.top + position.height / 2) * ratio - height / 2),
    left: Math.max(0, (position.left + position.width / 2) * ratio - width / 2) };
}

export function readingAnchorAdjustment(previousOffset: number, currentOffset: number) {
  return Number.isFinite(previousOffset) && Number.isFinite(currentOffset) ? currentOffset - previousOffset : 0;
}

/** display:none geometry is not a reading position. */
export function readingPaneVisible(pane: Pick<HTMLElement, "clientWidth" | "clientHeight" | "getClientRects">) {
  return pane.clientWidth > 0 && pane.clientHeight > 0 && pane.getClientRects().length > 0;
}

/** Viewport geometry -> native layout coordinates of a passage's toolbar host. */
export function blockActionsBottom(bottom: number, hostTop: number, renderedWidth: number, layoutWidth: number) {
  const scale = renderedWidth > 0 && layoutWidth > 0 ? renderedWidth / layoutWidth : 1;
  return Number.isFinite(bottom) && Number.isFinite(hostTop) && Number.isFinite(scale) ? Math.max(0, (bottom - hostTop) / scale) : 0;
}

/** Popup's top-left corner below the cursor/selection focus, bounded by the pane. */
export function highlightActionsPosition(endpoint: { right:number; bottom:number }, pane: { left:number; right:number; top:number; bottom:number }, width=220, height=28) {
  const gap=6,inset=8,available=Math.max(0,pane.right-pane.left-2*inset);
  const popupWidth=Math.min(width,available);
  return {x:Math.max(pane.left+inset,Math.min(pane.right-popupWidth-inset,endpoint.right+14)),
    y:Math.max(pane.top+inset,Math.min(pane.bottom-height-inset,endpoint.bottom+gap))};
}

export function arrowBlockDirection(key:string,offset:number,length:number,firstLine:boolean,lastLine:boolean) {
  if(key==="ArrowLeft" && offset===0 || key==="ArrowUp" && firstLine)return -1;
  if(key==="ArrowRight" && offset===length || key==="ArrowDown" && lastLine)return 1;
  return 0;
}
/** Coalesce gutter work without postponing it indefinitely during typing. */
export function layoutSchedule(run: () => void, delay = 100) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    request() {
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; run(); }, delay);
    },
    cancel() { if (timer !== undefined) clearTimeout(timer); timer = undefined; },
  };
}

/** A new global map must not repaint unrelated source blocks. */
export function sameBlockAnnotations(ids: readonly string[], beforeCounts: Record<string, number> | undefined, afterCounts: Record<string, number> | undefined,
  beforeMarkers: Record<string, {taskId:string;label:string;locked:boolean}> | undefined, afterMarkers: Record<string, {taskId:string;label:string;locked:boolean}> | undefined) {
  return ids.every(id => {
    const before=beforeMarkers?.[id],after=afterMarkers?.[id];
    return (beforeCounts?.[id] ?? 0)===(afterCounts?.[id] ?? 0) && before?.taskId===after?.taskId && before?.label===after?.label && before?.locked===after?.locked;
  });
}
