import { useRef, useState, type ReactNode } from "react";
import { useDismissibleLayer } from "../useDismissibleLayer";

export function ToolbarDetails({ children, summary, summaryLabel, className, onClose }: { children: ReactNode; summary: ReactNode; summaryLabel?: string; className: string; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const close = () => { setOpen(false); onClose?.(); };
  useDismissibleLayer(open, root, close, "summary");
  return <details ref={root} className={className} open={open} onToggle={(event) => {
    const next = event.currentTarget.open; setOpen(next); if (!next) onClose?.();
  }} onClick={(event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    // Nested choices can expand inside the panel; leaf actions close the panel.
    if (button && !button.disabled && !button.hasAttribute("data-keep-toolbar-open")) close();
  }}><summary aria-label={summaryLabel} title={summaryLabel}>{summary}</summary>{children}</details>;
}
