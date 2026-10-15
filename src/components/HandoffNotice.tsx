import { MessageSquareText, X } from "lucide-react";
import type { AttentionTask } from "../types";

/** Non-modal, task-bound notices: no browser/account observation or focus stealing. */
export function HandoffNotice({ waiting, ready, onPaste, onReturn, onFinishWithoutImport, onHideWaiting, onDismissReady }: {
  waiting: AttentionTask[]; ready: AttentionTask[]; onPaste: (task: AttentionTask) => void;
  onReturn: (id: string) => void; onFinishWithoutImport: (id: string) => void; onHideWaiting: () => void; onDismissReady: () => void;
}) {
  const task = ready[0] ?? waiting[0];
  if (!task) return null;
  const received = ready.length > 0;
  return <section className={`handoff-notice ${received ? "is-ready" : "is-waiting"}`} aria-label="Reply notice">
    <div className="handoff-notice-heading"><MessageSquareText size={15} /><strong role="status">{received ? `Reply received${ready.length > 1 ? ` (${ready.length})` : ""}` : `Waiting for reply${waiting.length > 1 ? ` (${waiting.length})` : ""}`}</strong>
      <button className="icon-control" aria-label={received ? "Dismiss reply notice" : "Hide waiting notice"} onClick={received ? onDismissReady : onHideWaiting}><X size={14} /></button>
    </div>
    <p className="handoff-notice-title">{task.title}</p>
    <small>{received ? "Reply saved. Keep working or return when ready." : "Paste the reply if you want to keep it. Nothing is sent to your chat or checked there automatically."}</small>
    <div className="handoff-notice-actions">{received ? <button onClick={() => onReturn(task.id)}>Return to task →</button> : <><button onClick={() => onPaste(task)}>Paste reply…</button><button onClick={() => onFinishWithoutImport(task.id)}>Done without saving reply</button></>}</div>
  </section>;
}
