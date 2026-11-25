import { useEffect, useRef, useState } from "react";
import { commentShortcut } from "../commentKeyboard";

/** Unsaved text stays in this field, outside workspace persistence and sync. */
export function CommentField({ id, body, autoFocus, isNew = false, onEdit, onSave }: {
  projectId: string; id: string; body: string; autoFocus: boolean;
  onEdit: (id: string, body: string) => void;
  onSave?: () => void;
  isNew?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const base = useRef(body);
  const composing = useRef(false);
  const [notice, setNotice] = useState("");
  const [canSave, setCanSave] = useState(Boolean(body.trim()));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (autoFocus) input.current?.focus({ preventScroll: true }); }, [autoFocus, id]);
  useEffect(() => {
    const field = input.current;
    if (!field || body === base.current) return;
    if (field.value === base.current || field.value === body) {
      field.value = body; base.current = body;
      setCanSave(Boolean(body.trim())); setDirty(false); setNotice("");
    } else setNotice("This comment changed elsewhere. Copy your unsaved text before reopening it; the saved comment has not been replaced.");
  }, [body]);
  function save() {
    const value = input.current?.value ?? "";
    if (composing.current || notice || !value.trim() || !isNew && value === body) return;
    if (body !== base.current && value !== body) {
      setNotice("This comment changed elsewhere. Your unsaved text is still here; reopen the comment before saving."); return;
    }
    onEdit(id, value); onSave?.();
  }
  return <>
    <textarea ref={input} aria-label="Review comment" data-comment-dirty={dirty || isNew && Boolean(body.trim()) ? "true" : undefined} placeholder="What needs attention?" maxLength={6000} rows={4} defaultValue={body}
      onKeyDown={event => { if (commentShortcut({ ...event, isComposing: event.nativeEvent.isComposing }) === "save") { event.preventDefault(); event.stopPropagation(); save(); } }}
      onChange={event => { setCanSave(Boolean(event.currentTarget.value.trim())); setDirty(event.currentTarget.value !== body); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
    {(isNew || dirty) && <div className="review-actions"><button className="primary-button" title="Save comment (Ctrl+Enter)" disabled={!canSave || Boolean(notice)} onClick={save}>{isNew ? "Save comment" : "Save changes"}</button></div>}
    {notice && <small role="status">{notice}</small>}
  </>;
}
