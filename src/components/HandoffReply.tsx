import { useState } from "react";
import { Copy, X } from "lucide-react";
import type { AttentionTask, Paragraph } from "../types";
import { FindingsReader } from "./FindingsReader";
import type { TaskSourceCheck } from "../taskSource";
import { canFinishWithoutImport } from "../attention";

export function HandoffReply({ task, sourceCheck, onInspectPosition, onReply, onImportReply, onCopy, onClose, onFinish, onFinishWithoutImport, onReopen, onFollowUp, onPrevious, canResume }: { task: AttentionTask; sourceCheck?: TaskSourceCheck; onInspectPosition?: (paragraph: Pick<Paragraph, "id" | "nodeId">) => void; onReply: (reply: string) => void; onImportReply?: (reply: string) => void; onCopy: () => void; onClose: () => void; onFinish: () => void; onFinishWithoutImport: () => void; onReopen: () => void; onFollowUp: () => void; onPrevious?: () => void; canResume: boolean }) {
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(!task.reply?.trim());
  const archived = task.status === "reviewed";
  const fileReturn = task.ticket?.transport === "files";
  const notebookReturn = Boolean(task.ticket?.notebookTarget);
  async function paste() {
    try { const text = await navigator.clipboard.readText(); if (text.trim()) { (onImportReply ?? onReply)(text); setEditing(false); setNotice("Reply saved. Return to the task when you're ready."); } else { setEditing(true); setNotice("Clipboard is empty. Copy the answer in your chat, then paste here when ready."); } }
    catch { setEditing(true); setNotice("Clipboard access unavailable. Paste into the field below using Ctrl+V or its Paste menu."); }
  }
  return <aside className="handoff-drawer" aria-label="External reply">
    <div className="drawer-heading"><button className="icon-control" aria-label="Close external reply" onClick={onClose}><X size={16} /></button><div><strong>{task.title}</strong><span>Reply saved with task · not checked</span></div></div>
    <div className="handoff-scroll"><p className="handoff-reply-note">{task.completedExternally ? "Finished in another app. No reply was saved here. Reopen the task to add it later." : archived ? `Saved in History. Reopen to edit the reply${fileReturn && !notebookReturn ? " or continue watching a response file" : ""}.` : notebookReturn ? "Your assistant writes notes and experiments directly into the notebook, then marks this request ready. Nothing starts automatically; completion doesn't resolve the task." : fileReturn ? "Paste a reply, or use a coding assistant to return a reply file. Nothing starts automatically." : "Saving the reply is optional. Use your chat's Copy button, then Paste reply here or Ctrl+V. Markdown and equations render here; your chat isn't monitored."}</p>
      {sourceCheck && (sourceCheck.status !== "unchanged" || sourceCheck.documentChanged || sourceCheck.locationUnverified) && <p className="source-check-note needs-attention" role="status">{sourceCheck.message}</p>}
      {task.sourceSnapshot && sourceCheck && <details className="source-comparison"><summary>Compare source · {sourceCheck.status}</summary><small>Compares text in the original file, not mathematical meaning.</small>{sourceCheck.matches.map((match) => <div key={match.before.id}><strong>{match.before.file ?? "Source"} · {match.state.replaceAll("-", " ")}{match.before.locationUnverified ? " · passage not confirmed" : ""}</strong><span className="field-label">At request time</span><pre>{match.before.text}</pre>{match.after && <><span className="field-label">{match.state === "position-changed" ? "Text at the old position · may be a different passage" : "Current text"}</span><pre>{match.after.text}</pre>{match.state === "position-changed" && onInspectPosition && <button className="secondary-button" onClick={() => onInspectPosition(match.after!)}>View current position</button>}</>}</div>)}{sourceCheck.added.map((paragraph) => <div key={`new:${paragraph.id}`}><strong>New excerpt · {paragraph.file ?? "Source"}</strong><pre>{paragraph.text}</pre></div>)}</details>}
      <button className="secondary-button" onClick={onCopy}><Copy size={14} /> Copy prompt</button> {!archived && <button className="secondary-button" onClick={() => void paste()}>Paste reply from clipboard</button>}
      {onPrevious && <button className="secondary-button" onClick={onPrevious}>Earlier reply</button>}
      {notice && <p role="status">{notice}</p>}
      {task.reply && <details open><summary>Reply</summary><FindingsReader text={task.reply} /></details>}
      {task.reply && <button className="secondary-button handoff-follow-up" onClick={onFollowUp}>Follow up on this reply →</button>}
      {!archived && <details open={editing} onToggle={(event) => setEditing(event.currentTarget.open)}><summary>{task.reply ? "Edit reply" : "Paste reply"}</summary><label className="field-label" htmlFor="external-reply">Reply</label><textarea id="external-reply" className="handoff-instruction" rows={10} value={task.replyDraft ?? task.reply ?? ""} onChange={(event) => onReply(event.target.value)} onPaste={(event) => {
        const text = event.clipboardData.getData("text/plain");
        if (!text.trim() || !onImportReply) return;
        const field = event.currentTarget;
        event.preventDefault();
        onImportReply(field.value.slice(0, field.selectionStart) + text + field.value.slice(field.selectionEnd));
      }} placeholder="Paste the reply here. It stays with this task when you leave." /></details>}
      <details className="handoff-packet"><summary>{notebookReturn ? "Saved notebook request" : fileReturn ? "Saved prompt and file details" : "Saved prompt"}</summary><pre>{task.ticket?.copyText ?? task.packet}</pre>{fileReturn && <><p>Prompt: {task.ticket?.promptPath ?? task.handoffPath}</p><p>{notebookReturn ? `Notebook owner: ${task.ticket?.notebookTarget?.notebookId} · no response file needed` : `Response: ${task.ticket?.responsePath}`}</p></>}<small>Task ID: {task.id}. Completion doesn't affect the LaTeX. No edits are applied automatically.</small></details>
    </div>
    <div className="handoff-review-footer">{archived ? <button className="secondary-button" onClick={onReopen}>Reopen saved task</button> : canFinishWithoutImport(task) ? <><small>Happy with the answer in your chat? Keep working without saving it here. The prompt stays in History.</small><button className="secondary-button" onClick={onFinishWithoutImport}>Done without saving reply</button></> : task.status === "ready" && <><small>Finishing keeps the reply in History; it doesn't mark the mathematics correct.</small><button className="primary-button" onClick={onFinish}>{canResume ? "Finish & resume other work" : "Finish & next task"}</button></>}</div>
  </aside>;
}
