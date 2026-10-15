import { createElement, memo, useState, type ReactNode, type SyntheticEvent } from "react";

/** Native accessible disclosure; hidden Markdown/math is not evaluated at all.
 * Folding only discards display nodes, never the retained source or drafts. */
export const LazyDisclosure = memo(function LazyDisclosure({ summary, children, initialOpen = false, className }: {
  summary: ReactNode; children: ReactNode; initialOpen?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  return createElement("details", { className, open, onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => setOpen(event.currentTarget.open) },
    createElement("summary", null, summary), open ? children : null);
});
