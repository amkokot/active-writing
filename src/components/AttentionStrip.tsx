import { useEffect, useState, type CSSProperties } from "react";
import { Check, ChevronDown, ClipboardPaste, Copy, GripVertical, RotateCcw, X } from "lucide-react";
import type { AppState, AttentionTask } from "../types";
import type { WorkSuggestion } from "../notebook";
import { attentionHistory, attentionQueue, canFinishWithoutImport, queueColorPageSize, queueColorVariables, queueWaitLabel, queueWarmth, taskStatusLabel } from "../attention";
import type { QueueScope } from "../projectQueue";

export interface AttentionStripProps {
  settings: AppState["suggestions"];
  tasks: AttentionTask[];
  suggestion?: WorkSuggestion;
  onSettings: (settings: AppState["suggestions"]) => void;
  onNext: () => void;
  onReturn: (task: AttentionTask) => void;
  onCopy: (task: AttentionTask) => void;
  onDismiss: (id: string) => void;
  onReady: (task: AttentionTask) => void;
  onReopen: (id: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  resolvableCommentIds?: string[];
  resolveCommentsProjectId?: string;
  onResolveComments?: (ids: string[]) => void;
  onClose?: () => void;
  taskLabel?: (task: AttentionTask) => string;
  onMove?: (id: string, targetId: string, after?: boolean) => void;
  onResetColors?: () => void;
  onFinishWithoutImport?: (id: string) => void;
  now?: number;
  scope?: QueueScope;
  onScope?: (scope: QueueScope) => void;
  queueLoading?: boolean;
  queueError?: string;
}
export function AttentionStrip({ settings, tasks, suggestion, onSettings, onNext, onReturn, onCopy, onDismiss, onReady, onReopen, onResolveComment, resolvableCommentIds, resolveCommentsProjectId, onResolveComments, onClose, taskLabel = task => task.title, onMove, onResetColors, onFinishWithoutImport, scope, onScope, queueLoading, queueError, now = Date.now() }: AttentionStripProps) {
  const [dragging, setDragging] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const [expandedId, setExpandedId] = useState<string>();
  const [page, setPage] = useState(0);
  const [confirmComments, setConfirmComments] = useState<string[]>();
  useEffect(() => { setConfirmComments(undefined); }, [resolveCommentsProjectId, scope]);
  const queue = attentionQueue(tasks, now);
  const eligibleComments = new Set(resolvableCommentIds);
  const commentIds = queue.filter(task => task.review?.kind === "comment" && eligibleComments.has(task.id)).map(task => task.id);
  const pages = Math.max(1, Math.ceil(queue.length / queueColorPageSize));
  const visiblePage = Math.min(page, pages - 1);
  const visibleQueue = queue.slice(visiblePage * queueColorPageSize, (visiblePage + 1) * queueColorPageSize);
  const tones = queueWarmth(queue, now);
  const warmth = new Map(queue.map((task, index) => [task.id, tones[index]]));
  const history = attentionHistory(tasks);
  const ready = queue.filter((t) => t.status === "ready");
  // The toolbar's split queue control is the single entry point.
  if (settings.minimized) return null;
  function move(id: string, target: string, after = false) { onMove?.(id, target, after); setAnnouncement("Queue order saved."); }
  function row(task: AttentionTask, archived = false) {
    const label = taskLabel(task);
    return <div className={`work-task${archived ? " is-history" : ""}${dropTarget === task.id ? " is-drop-target" : ""}`} key={task.id} data-task-id={task.id} style={queueColorVariables(warmth.get(task.id) ?? 0) as CSSProperties}
      onDragOver={event => { if (!archived && dragging && dragging !== task.id) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(task.id); } }}
      onDrop={event => { if (!archived && dragging) { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); move(dragging, task.id, event.clientY > bounds.top + bounds.height / 2); setDragging(undefined); setDropTarget(undefined); } }}>
      <div className="work-task-line">{!archived && onMove && <button className="queue-drag-handle" draggable aria-label={`Reorder ${label}`} title="Drag to reorder · Arrow keys move up/down" onDragStart={event => { setDragging(task.id); event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragging(undefined); setDropTarget(undefined); }} onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault(); const index = queue.findIndex(item => item.id === task.id), after = event.key === "ArrowDown";
        const target = queue[index + (after ? 1 : -1)]; if (target) move(task.id, target.id, after);
      }}><GripVertical size={13} /></button>}<button className="queue-task-target" title={task.title} onClick={() => onReturn(task)}><span>{label}</span><small>{task.deferredAt && task.ticket && !task.localJobId && ["queued", "working"].includes(task.status) ? queueWaitLabel(task, now) : taskStatusLabel(task)}</small></button>
        {task.packet && <button aria-label={`Copy prompt for ${task.title}`} onClick={() => onCopy(task)}><Copy size={13} /></button>}
        {task.queueHiddenAt ? <button onClick={() => onReopen(task.id)} aria-label={`Return ${label} to queue`}>Return to queue</button> : task.review?.kind === "comment" ? <button className="queue-finish" aria-label={`${archived ? "Reopen" : "Resolve"} ${label}`} title={archived ? "Reopen comment" : "Resolve comment"} onClick={() => onResolveComment(task.id, !archived)}>{archived ? <RotateCcw size={13} /> : <Check size={13} />}</button> : archived ? <button onClick={() => onReopen(task.id)} aria-label={`Reopen ${task.title}`}>Reopen</button> : <>
          {!task.localJobId && !task.reminder && task.writing?.kind !== "paragraph" && <button aria-label={`${task.status === "ready" ? "View reply" : "Paste reply"} for ${label}`} title={task.status === "ready" ? "View reply" : "Paste reply"} onClick={() => onReady(task)}><ClipboardPaste size={13} /></button>}
          <button className="queue-finish" aria-label={`${task.writing?.kind === "paragraph" ? "Review" : "Finish"} ${label}`} title={task.writing?.kind === "paragraph" ? "Open guided word-by-word review; this does not approve text" : task.localJobId && ["queued", "working"].includes(task.status) ? "Finish task and stop local request; keep in History" : canFinishWithoutImport(task) ? "Finished elsewhere; no pasted answer needed" : "Finish task; keep in History"} onClick={() => canFinishWithoutImport(task) && onFinishWithoutImport ? onFinishWithoutImport(task.id) : onDismiss(task.id)}><Check size={13} /></button>
        </>}
        {task.packet && <button className="queue-prompt-toggle" aria-label={`Saved prompt for ${task.title}`} title="Saved prompt" aria-expanded={expandedId === task.id} onClick={() => setExpandedId(expandedId === task.id ? undefined : task.id)}><ChevronDown size={12} /></button>}
      </div>
      {task.error && <small className="work-task-error" role="status">{task.error}</small>}
      {task.packet && expandedId === task.id && <div className="work-saved-prompt"><textarea aria-label={`Saved prompt text for ${task.title}`} readOnly value={task.ticket?.copyText ?? task.packet} rows={5} /><small>{task.handoffPath ?? "Saved with this question"}</small></div>}
    </div>;
  }
  return <section className="work-strip" aria-label="Queued work">
    <div className="work-strip-heading"><strong title="Warmer = higher priority and longer unattended. Weeks 1–4: gold, amber, copper, rust, with smaller shifts in later weeks. Lower rows stay cooler when reordered; ✓ finishes. Maximum at 30 days.">Priority queue <small>{queue.length}{ready.length ? ` · ${ready.length} ready` : ""}</small></strong>{onScope && <div className="queue-scope" role="group" aria-label="Queue projects">{(["project", "all"] as const).map(value => <button key={value} aria-pressed={scope === value} onClick={() => { setPage(0); setExpandedId(undefined); onScope(value); }}>{value === "project" ? "This project" : "All projects"}</button>)}</div>}<div className="queue-heading-actions">{onResetColors && <button aria-label="Reset queue colors" title="Reset colors · keep every item and the current order" disabled={!queue.length} onClick={() => { onResetColors(); setAnnouncement("Colors reset. Queue order and waiting times unchanged."); }}><RotateCcw size={12} /><span>Reset colors</span></button>}<button aria-label="Close priority queue" onClick={onClose}><X size={13} /></button></div></div>
      {onResolveComments && <div className="queue-comment-actions"><button disabled={!commentIds.length || Boolean(confirmComments)} onClick={() => setConfirmComments(commentIds)}>Resolve all comments…{commentIds.length > 0 ? ` (${commentIds.length})` : ""}</button><small>Queued comments in this project only; other projects and task types stay unchanged.</small></div>}
      {confirmComments && <div className="queue-comment-confirm" role="group" aria-label="Confirm resolving all comments"><p>Resolve {confirmComments.length} queued {confirmComments.length === 1 ? "comment" : "comments"} and their replies in this project, across all queue pages? This includes replies set aside from the queue. Quotes and full threads remain in History, where comments can be reopened. This does not approve manuscript wording.</p><button className="primary-button" onClick={() => { onResolveComments?.(confirmComments); setConfirmComments(undefined); setAnnouncement("Comment resolution requested. Other tasks are unchanged."); }}>Resolve comments & replies</button><button onClick={() => setConfirmComments(undefined)}>Cancel</button></div>}
      {(queueLoading || queueError) && <small className="queue-fetch-status" role="status">{queueLoading ? "Checking other projects…" : queueError}</small>}
      <div className="work-task-details"><span className="queue-announcement" role="status">{announcement}</span>{visibleQueue.map((task) => row(task))}{!queue.length && <p>Nothing queued. Use Later, leave a comment, send a prompt, or mark a section in progress.</p>}</div>
      {pages > 1 && <nav className="queue-pages" aria-label="Queue pages"><button aria-label="Previous queue page" disabled={!visiblePage} onClick={() => setPage(visiblePage - 1)}>←</button><small>{visiblePage * queueColorPageSize + 1}–{Math.min(queue.length, (visiblePage + 1) * queueColorPageSize)} of {queue.length}</small><button aria-label="Next queue page" disabled={visiblePage === pages - 1} onClick={() => setPage(visiblePage + 1)}>→</button></nav>}
      <details className="queue-suggestions"><summary>Suggested work{suggestion ? " · 1" : ""}</summary><div className="work-strip-heading"><div className="work-relation" aria-label="Suggestion relationship">{(["related", "unrelated"] as const).map((relation) => <button key={relation} aria-pressed={settings.relation === relation} onClick={() => onSettings({ ...settings, relation })}>{relation === "related" ? "Related" : "Unrelated"}</button>)}</div></div>
      <div className="work-suggestion">{suggestion ? <><span><strong>{suggestion.title}</strong><small>{suggestion.detail}</small></span><button onClick={onNext}>Go →</button></> : <p>No {settings.relation} work available here. Try the other option.</p>}</div>
      </details>
      {history.length > 0 && <details className="work-task-details"><summary>Task history ({history.length})</summary><p>Finished or set-aside tasks. Reopening puts a task back in the queue; it doesn't send a new request.</p>{history.map((task) => row(task, true))}</details>}
  </section>;
}
