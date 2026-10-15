import { useEffect, useId, useRef, useState } from "react";
import { Bot, ChevronDown, MessageSquareText, Sparkles, SquarePen, Wrench, WandSparkles } from "lucide-react";

interface Props {
  context: string;
  disabled: boolean;
  onExplore: () => void;
  onRewrite: () => void;
  onChat: () => void;
  onAgent: () => void;
  onReview: () => void;
  onWrite: () => void;
}

export function WorkspaceTools({ context, disabled, onExplore, onRewrite, onChat, onAgent, onReview, onWrite }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    window.addEventListener("pointerdown", outside); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open]);
  const run = (action: () => void) => { setOpen(false); action(); };
  return <div className="workspace-tools" ref={root}>
    <button ref={trigger} className="reference-toolbar-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} disabled={disabled}><Wrench size={14} /> Tools <ChevronDown size={12} /></button>
    {open && <div className="workspace-tools-menu" id={id} aria-label="Passage tools">
      <small>Working on {context}. Select text to work on a smaller passage.</small>
      <button onClick={() => run(onRewrite)}><WandSparkles size={16} /><span>Rephrase paragraph<small>Quick suggestions or help on this computer</small></span></button>
      <button onClick={() => run(onWrite)}><SquarePen size={16} /><span>Write a small step<small>Linked paragraphs, reviewed one by one</small></span></button>
      <button onClick={() => run(onExplore)}><Sparkles size={16} /><span>Ask about this passage<small>Save a question in your notebook</small></span></button>
      <button onClick={() => run(onReview)}><MessageSquareText size={16} /><span>Comments &amp; review<small>Queued comments and review requests</small></span></button>
      <div className="workspace-tools-divider" />
      <button onClick={() => run(onChat)}><MessageSquareText size={16} /><span>Copy to chat<small>Paste into any chat; nothing is sent here</small></span></button>
      <button onClick={() => run(onAgent)}><Bot size={16} /><span>Use a coding assistant<small>Share a folder; replies appear here</small></span></button>
    </div>}
  </div>;
}
