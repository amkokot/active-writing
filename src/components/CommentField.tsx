import { useEffect, useRef, useState } from "react";
import { createCommentBuffer } from "../commentBuffer";
import { windowStateCache } from "../windowCache";
import { useStableEvent } from "../useStableEvent";

/** Only this small field handles keystrokes; the review panel stays unchanged. */
export function CommentField({ projectId, id, body, autoFocus, onEdit }: {
  projectId: string; id: string; body: string; autoFocus: boolean;
  onEdit: (id: string, body: string) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState("");
  const [kept, setKept] = useState("");
  const edit = useStableEvent(onEdit);
  const key = `active-writing.comment.v1.${projectId}.${id}`;
  const [buffer] = useState(() => createCommentBuffer(body, {
    commit: value => edit(id, value),
    keep: (value, base) => {
      try {
        const draft = JSON.stringify({ value, base });
        // This is at most two short comments, never the manuscript/notebook.
        // Raw storage also avoids compression on the input event.
        windowStateCache().writeSnapshot(key, draft, JSON.stringify({ value: base, base }), draft);
      }
      catch { setNotice("Browser draft storage is unavailable. Keep this field open until your comment saves."); }
    },
    conflict: () => {
      setKept(input.current?.value ?? "");
      setNotice("This comment changed elsewhere. Your draft is kept below; the incoming comment has not been replaced.");
    },
  }));
  useEffect(() => {
    try {
      const record = JSON.parse(windowStateCache().read(key) ?? "null");
      if (record && typeof record.base === "string" && typeof record.value === "string" && record.value.length <= 6000 && record.value !== body) {
        if (record.base === body) { if (input.current) input.current.value = record.value; buffer.change(record.value); }
        else { setKept(record.value); setNotice("A previous draft is kept below. The saved comment changed since it was written."); }
      }
    } catch { /* Never replace saved text with an invalid recovery record. */ }
    const flush = () => buffer.flush();
    const visibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", visibility); buffer.dispose(); };
  }, [buffer, key]);
  useEffect(() => { const next = buffer.receive(body); if (next !== undefined && input.current) input.current.value = next; }, [body, buffer]);
  return <>
    <textarea ref={input} autoFocus={autoFocus} aria-label="Review comment" placeholder="What needs attention? Saved as you type." maxLength={6000} rows={4} defaultValue={body}
      onChange={event => buffer.change(event.currentTarget.value)} onBlur={() => buffer.flush()}
      onCompositionStart={() => buffer.composition(true)} onCompositionEnd={() => buffer.composition(false)} />
    {notice && <small role="status">{notice}</small>}
    {kept && <details open><summary>Kept comment draft</summary><textarea aria-label="Kept comment draft" readOnly value={kept} rows={4} /><small>Copy any text you want to keep into the saved comment after reopening it.</small></details>}
  </>;
}
