import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStableEvent } from "../useStableEvent";
import { windowStateCache } from "../windowCache";
import type { ManuscriptNode } from "../types";
import { MessageSquareText } from "lucide-react";
import { sourceCommandId } from "../taskSource";

export type SourceCommandRange = NonNullable<ManuscriptNode["sourceOpening"]>;
export interface SourceCommandEditing {
  identity: string;
  register: (key: string, flush?: () => Promise<void>) => void;
  save: (nodeId: string, closing: boolean, command: SourceCommandRange, value: string) => Promise<void>;
  comment?: (selection: { nodeId: string; command: "opening" | "closing"; file: string; value: string; start: number; end: number }) => Promise<void>;
}

/** Structural source stays in the same pane; only the exact command range is saved. */
export function SourceCommand({ nodeId, closing = false, command, editable, editing }: {nodeId: string; closing?: boolean; command: SourceCommandRange; editable: boolean; editing?: SourceCommandEditing}) {
  const key = `${editing?.identity}:${nodeId}:${closing ? "end" : "start"}`;
  const cacheKey = `active-writing.command.${key}`;
  const [value, setValue] = useState(() => {
    try { const kept = JSON.parse(windowStateCache().read(cacheKey) || "null"); return kept?.original === command.text && typeof kept.draft === "string" ? kept.draft : command.text; }
    catch { return command.text; }
  });
  const draft = useRef(value), original = useRef(command.text), running = useRef<Promise<void> | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string>(), [saving, setSaving] = useState(false);
  const save = useStableEvent(async () => {
    if (running.current) await running.current;
    if (!editing || draft.current === original.current) return;
    const submitted = draft.current;
    const operation = (async () => {
      setSaving(true);
      try {
        await editing.save(nodeId, closing, {...command, text: original.current}, submitted);
        original.current = submitted; setError(undefined);
        if (draft.current === submitted) windowStateCache().clearOwn(cacheKey);
      } catch (reason) { setError((reason as Error).message); throw reason; }
      finally { setSaving(false); }
    })();
    running.current = operation;
    try { await operation; } finally { running.current = undefined; }
  });
  useEffect(() => { editing?.register(key, save); return () => editing?.register(key); }, [editing?.register, key, save]);
  useEffect(() => {
    if (draft.current === original.current) { draft.current = command.text; original.current = command.text; setValue(command.text); }
  }, [command.text]);
  useLayoutEffect(() => { const element = input.current; if (element) { element.style.height = "0"; element.style.height = `${element.scrollHeight}px`; } }, [value]);
  return <div className="inline-source-command">
    <textarea ref={input} className="literal-source-command" data-source-command-id={sourceCommandId(nodeId, closing ? "closing" : "opening")} aria-label={closing ? "Edit closing LaTeX command" : "Edit LaTeX heading or opening command"}
      title="Edit here · saved when leaving this command · Ctrl/⌘ Enter to save" spellCheck={false} wrap="soft" readOnly={!editable || !editing || saving} value={value}
      onChange={event => {
        const next = event.target.value; draft.current = next; setValue(next);
        try { windowStateCache().writeSnapshot(cacheKey, JSON.stringify({original: original.current, draft: next}), JSON.stringify({original: original.current, draft: original.current})); }
        catch { setError("Browser storage is full. Keep this editor open and copy your command."); }
      }}
      onBlur={() => { void save().catch(() => undefined); }}
      onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save().catch(() => undefined); } }} />
    {editing?.comment && <button className="command-comment-button" aria-label={closing ? "Comment on closing command" : "Comment on heading or opening command"} title="Comment on selected heading text, or the whole command" disabled={saving}
      onMouseDown={event => event.preventDefault()} onClick={() => {
        const field = input.current; if (!field) return;
        const start = field.selectionStart === field.selectionEnd ? 0 : field.selectionStart;
        const end = field.selectionStart === field.selectionEnd ? field.value.length : field.selectionEnd;
        void editing.comment!({ nodeId, command: closing ? "closing" : "opening", file: command.file, value: field.value, start, end }).catch(reason => setError((reason as Error).message));
      }}><MessageSquareText size={14} /></button>}
    {error && <small role="alert">{error} <button onClick={() => { void save().catch(() => undefined); }}>Retry</button></small>}
  </div>;
}
