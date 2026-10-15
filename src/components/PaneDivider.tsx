import { useState, type CSSProperties } from "react";
import { boundedPaneShare } from "../editorGeometry";
export function usePaneSplit() {
  const [share, setShare] = useState(() => {
    try { const saved = sessionStorage.getItem("active-writing.pane-share"); return saved === null ? 0.5 : boundedPaneShare(Number(saved)); }
    catch { return 0.5; }
  });
  const change = (value: number) => {
    setShare(value);
    try { sessionStorage.setItem("active-writing.pane-share", String(value)); } catch { /* resizing still works */ }
  };
  return { share, change, style: { "--source-share": `${share}fr`, "--preview-share": `${1 - share}fr` } as CSSProperties };
}
export function PaneDivider({ share, onChange }: { share: number; onChange: (value: number) => void }) {
  return <div className="pane-divider" role="separator" aria-label="Source and preview width" aria-orientation="vertical"
    aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(share * 100)} tabIndex={0}
    title="Drag to resize · double-click to balance · arrow keys to adjust"
    onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      onChange(boundedPaneShare((event.clientX - bounds.left - 3) / Math.max(1, bounds.width - 6), bounds.width));
    }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onDoubleClick={() => onChange(0.5)}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const width = event.currentTarget.parentElement!.getBoundingClientRect().width;
      onChange(boundedPaneShare(event.key === "Home" ? 0 : event.key === "End" ? 1 : share + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 0.1 : 0.02), width));
    }} />;
}
