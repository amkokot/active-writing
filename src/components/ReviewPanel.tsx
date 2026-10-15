import { ArrowLeft, ArrowRight, ArrowUpRight, MessageSquareText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AttentionTask, ProjectDocument, HandoffDraft, ReviewComment } from "../types";
import { reviewComments, reviewCommentTitle, defaultReviewInstructions, reviewCommentTarget, reviewCommentLocation, adjacentReviewComment, nextCommentOutsideBlock } from "../review";
import { checkTaskSource } from "../taskSource";
import { LazyDisclosure } from "../lazyDisclosure";
import { attentionQueue } from "../attention";

export function ReviewPanel({ onReply, blockComments, onAllComments, onOutsideComment, tasks, document, edits, selectedId, instructions, busy, protectedText, onProtect, onClose, onSelect, onJump, onAdd, onEdit, onResolve, onAsk, onRewrite, onInstructions, onExport, onImport, onArchive, onDraftReply, onSavePacket }: {
  onReply: (id: string, body: string) => void;
  blockComments?: AttentionTask[]; onAllComments?: () => void;
  onOutsideComment: (task: AttentionTask) => void;
  tasks: AttentionTask[]; document: ProjectDocument; edits: Record<string, string>; selectedId?: string; instructions: Record<string, HandoffDraft>; busy: boolean;
  protectedText: boolean; onProtect: (protect: boolean) => void;
  onClose: () => void; onSelect: (task: AttentionTask) => void; onJump: (task: AttentionTask) => void; onAdd: () => void; onEdit: (id: string, body: string) => void; onResolve: (id: string, resolved: boolean) => void;
  onAsk: (task: AttentionTask) => void; onRewrite: (task: AttentionTask) => void; onInstructions: (mode: "human" | "ai", text: string) => void;
  onExport: (mode: "human" | "ai", scope: "paragraph" | "section" | "paper", route: "codex" | "chatgpt", instructions: string) => Promise<void>;
  onImport: (id: string, reply: string) => void; onArchive: (id: string) => void;
  onDraftReply: (id: string, reply: string) => void; onSavePacket: (task: AttentionTask) => Promise<void>;
}) {
  const [mode, setMode] = useState<"human" | "ai">("human"), [scope, setScope] = useState<"paragraph" | "section" | "paper">("section"), [route, setRoute] = useState<"codex" | "chatgpt">("codex");
  const [notice, setNotice] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const navigationTasks = blockComments ?? tasks;
  const outsideComment = blockComments && nextCommentOutsideBlock(tasks, blockComments, selectedId);
  const open = reviewComments(blockComments ?? attentionQueue(tasks)), resolved = reviewComments(tasks, true);
  const selected = tasks.find(t => t.id === selectedId && t.review?.kind === "comment");
  const comment = selected?.review as ReviewComment | undefined;
  const noteField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (selected?.review?.kind === "comment" && selected.review.author === "human" && !selected.review.body) noteField.current?.focus(); }, [selected?.id]);
  const source = selected && checkTaskSource(selected.sourceSnapshot, document, edits);
  const location = selected && reviewCommentLocation(selected, document, edits);
  const otherManuscript = Boolean(selected?.sourceSnapshot && (selected.sourceSnapshot.projectId !== document.project.id || selected.sourceSnapshot.rootFile !== document.project.mainFile));
  const editableQuote = selected && reviewCommentTarget(selected, document, edits);
  const request = tasks.find(t => t.id === selectedId && t.review?.kind === "request") ?? [...tasks].reverse().find(t => t.review?.kind === "request" && t.status !== "reviewed");
  useEffect(() => {
    const task = tasks.find(t => t.id === selectedId);
    if (task?.review?.kind === "request") { setMode(task.review.mode); setPreparing(false); }
    setNotice("");
  }, [selectedId]);
  const instruction = instructions[`review:${mode}`]?.instruction ?? defaultReviewInstructions[mode];
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setNotice("Copied. Nothing was sent."); return true; } catch { setNotice("Clipboard unavailable. Select the saved packet text below."); return false; } }
  async function copyAnnotated(task: AttentionTask) {
    try {
      const response = await fetch("/api/paperfocus/review/annotated", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: document.project.id, id: task.id, reply: task.reply }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      if (await copy(result.text)) setNotice("Annotated review copied for your web chat. Nothing was sent.");
    } catch (error) { setNotice(String(error instanceof Error ? error.message : error)); }
  }
  const rows = (list: AttentionTask[]) => list.map(t => <button className={`review-list-item ${t.id === selectedId ? "is-active" : ""}`} key={t.id} onClick={() => onSelect(t)}><span>{t.review?.kind === "comment" ? reviewCommentTitle(t.review.body, t.review.quote) : t.title}</span><small>{t.review?.kind === "comment" && (t.review.author === "human" ? "Your comment" : "Assistant · unchecked")} · {t.sourceSnapshot?.nodeTitle}</small></button>);
  const move = (direction: -1 | 1) => { const task = adjacentReviewComment(navigationTasks, selectedId, direction); if (task) onSelect(task); };
  return <section className="review-panel" aria-label="Queue comment details">
    <header className="inspector-header"><h2><MessageSquareText size={17} /> {selected ? "Comment" : "Review"}</h2><button aria-label="Close review" onClick={onClose}><X size={16} /></button></header>
    {blockComments && <div className="block-comments-list" aria-label="Comments on this block"><strong>Comments on this block</strong>{rows(blockComments)}{!blockComments.length && <small>No open comments remain on this block.</small>}<button disabled={!outsideComment} title={outsideComment ? "Leave this block's list and open the next unresolved comment in queue order" : "No other open comments"} onClick={() => { if (outsideComment) onOutsideComment(outsideComment); }}>Next comment outside this block <ArrowRight size={14} /></button><button onClick={onAllComments}>Show all comments</button></div>}
    <div className="review-navigation" aria-label="Unresolved comments"><button aria-label="Previous unresolved comment" disabled={!open.length} onClick={() => move(-1)}><ArrowLeft size={14} /></button><span>{open.some(t => t.id === selectedId) ? `${open.findIndex(t => t.id === selectedId) + 1} / ${open.length} open` : `${open.length} open`}<small>{blockComments ? "On this block" : "In your priority queue"}</small></span><button aria-label="Next unresolved comment" disabled={!open.length} onClick={() => move(1)}><ArrowRight size={14} /></button></div>
    {selected && comment && <article className="review-current" aria-label="Selected review comment">
      <small>{comment.author === "human" ? "Your comment" : `Assistant comment · unchecked${comment.editedByHuman ? " · edited by you" : ""}`}{selected.status === "reviewed" ? " · resolved" : ""}</small>
      <div className="review-actions review-location"><button className="primary-button" aria-label="Jump to commented text" disabled={busy || !location && !otherManuscript} title={otherManuscript ? `Open ${selected.sourceSnapshot?.rootFile} and locate the saved passage` : location ? "Show this passage in source and preview" : source?.message} onClick={() => onJump(selected)}><ArrowUpRight size={14} /> Jump to commented text</button></div>
      <small>{location ? `${document.nodes.find(node => node.id === location.nodeId)?.title ?? "Passage"} · ${document.paragraphs.find(p => p.id === location.paragraphId)?.file ?? document.project.mainFile}` : otherManuscript ? `In ${selected.sourceSnapshot?.rootFile}. Jump opens its project and manuscript before checking the location.` : "The original passage could not be located safely. Its saved quote is shown below."}</small>
      {location?.changedBlock && <small>The text was edited. Jump returns to its saved block, not an exact quoted range.</small>}
      <blockquote>{comment.quote}</blockquote>
      <textarea ref={noteField} aria-label="Review comment" placeholder="What needs attention? Saved as you type." maxLength={6000} rows={4} value={comment.body} onChange={event => onEdit(selected.id, event.target.value)} />
      <small>{location?.changedBlock ? "The remembered block is available, but the original quoted range no longer matches." : source?.message} The saved quote is kept even if its location changes.</small>
      {comment.replyTo && <button onClick={() => { const parent = tasks.find(t => t.id === comment.replyTo); if (parent) onSelect(parent); }}>Original comment →</button>}
      {tasks.some(t => t.review?.kind === "comment" && t.review.replyTo === selected.id) && <div className="comment-thread-replies" aria-label="Replies to this comment"><strong>Replies</strong>{rows(tasks.filter(t => t.review?.kind === "comment" && t.review.replyTo === selected.id))}</div>}
      <div className="review-actions"><button onClick={() => setReplyingTo(replyingTo === selected.id ? undefined : selected.id)}>Reply</button></div>
      {replyingTo === selected.id && <div className="comment-reply-composer"><textarea autoFocus aria-label="Comment reply" rows={3} maxLength={6000} placeholder="Add a reply. The original comment is kept." value={replyDrafts[selected.id] ?? ""} onChange={event => setReplyDrafts(current => ({ ...current, [selected.id]: event.target.value }))} /><button disabled={busy || !replyDrafts[selected.id]?.trim()} onClick={() => { onReply(selected.id, replyDrafts[selected.id]); setReplyingTo(undefined); }}>Save reply</button><button onClick={() => setReplyingTo(undefined)}>Cancel reply</button></div>}
      <div className="review-actions"><button className="primary-button" onClick={() => onResolve(selected.id, selected.status !== "reviewed")}>{selected.status === "reviewed" ? "Reopen comment" : "Resolve"}</button></div>
      <div className="review-actions"><button disabled={!editableQuote || Boolean(editableQuote.command)} onClick={() => onAsk(selected)}>Ask</button><button disabled={!editableQuote || Boolean(editableQuote.command)} onClick={() => onRewrite(selected)}>Rephrase</button><button aria-pressed={!protectedText} onClick={() => onProtect(!protectedText)}>{protectedText ? "Enable typing" : "Protect text"}</button></div>
      <small>Resolve closes this comment and its replies; the full thread stays in History. Reopen affects only the selected comment.</small>
    </article>}
    {!selected && <div className="review-actions"><button onClick={onAdd}>+ Comment on passage</button></div>}
    <details open={preparing} onToggle={event => setPreparing(event.currentTarget.open)} className="review-export"><summary>{mode === "human" && open.length ? "Pass comments to an assistant" : "Request a review"}</summary>
      <label>Request<select aria-label="Review request type" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="human">Respond to open comments</option><option value="ai">Independent manuscript review</option></select></label>
      <label>Review instructions<textarea aria-label="Review instructions" maxLength={6000} rows={4} value={instruction} onChange={event => onInstructions(mode, event.target.value)} /></label>
      <label>Include<select aria-label="Review scope" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="paragraph">Active paragraph</option><option value="section">Current section and its subsections</option><option value="paper">Whole paper · within export limit</option></select></label>
      <label>Use with<select aria-label="Review destination" value={route} onChange={event => setRoute(event.target.value as typeof route)}><option value="codex">Shared-folder assistant</option><option value="chatgpt">Any web chat</option></select></label>
      <button className="primary-button" disabled={busy || mode === "human" && !open.length} onClick={() => void onExport(mode, scope, route, instruction).catch(error => setNotice(String(error.message ?? error)))}>{busy ? "Preparing…" : "Save instructions & copy prompt"}</button>
      <small>Creates editable instructions and an annotated text file. No assistant starts and nothing is sent automatically.</small>
    </details>
    {request && <LazyDisclosure key={request.id} className="review-packet" summary={`Saved review packet · ${request.status === "ready" ? "comments imported" : request.status === "reviewed" ? "in history" : "awaiting reply"}`} initialOpen={request.id === selectedId}>
      <div className="review-actions"><button onClick={() => void copy(request.ticket?.copyText ?? request.packet ?? "")}>{request.route === "codex" ? "Copy folder instructions" : "Copy review prompt"}</button>{request.route === "codex" && <button onClick={() => void copy(request.packet ?? "")}>Copy original text for web chat</button>}</div>
      {request.status === "ready" && <button onClick={() => void copyAnnotated(request)}>Copy annotated review for web chat</button>}
      {request.review?.kind === "request" && <details><summary>Saved files</summary><pre className="review-file-paths">{request.review.instructionsPath}{"\n"}{request.review.webPath}{request.review.completedPath ? `\n${request.review.completedPath}` : ""}</pre></details>}
      <small>Returned AI comments get their own text file with thinking instructions at the top. Importing a reply never resolves them; a separate revision pass may resolve verified simple fixes.</small>
      {request.error && <p role="alert">{request.error}</p>}
      {!request.ticket && <button disabled={busy} onClick={() => void onSavePacket(request).catch(error => setNotice(String(error.message ?? error)))}>Save packet files · retry</button>}
      <LazyDisclosure summary="Paste comments JSON · optional"><textarea aria-label="Review reply JSON" rows={6} value={request.replyDraft ?? ""} onChange={event => onDraftReply(request.id, event.target.value)} onPaste={event => { const text = event.clipboardData.getData("text/plain"), field = event.currentTarget; if (text.trim()) { event.preventDefault(); onImport(request.id, field.value.slice(0, field.selectionStart) + text + field.value.slice(field.selectionEnd)); } }} /><button onClick={() => onImport(request.id, request.replyDraft ?? "")}>Import comments</button><button onClick={() => void navigator.clipboard.readText().then(reply => onImport(request.id, reply), () => setNotice("Use Ctrl+V in the comments JSON field."))}>Paste comments from clipboard</button></LazyDisclosure>
      {request.reply && <details><summary>Exact assistant reply</summary><pre>{request.reply}</pre></details>}
      <details><summary>Annotated source text</summary><textarea aria-label="Saved review packet" readOnly rows={8} value={request.packet ?? ""} /></details>
      {request.status !== "reviewed" && <button onClick={() => onArchive(request.id)}>{request.status === "ready" ? "Keep packet in history · leave comments open" : "Finish request without importing · leave comments open"}</button>}
    </LazyDisclosure>}
    {notice && <p role="status">{notice}</p>}
    {!open.length && <p className="review-small">{blockComments ? outsideComment ? "This block is finished. Use Next comment outside this block to continue." : "This block is finished. No other open comments remain." : "No open comments. Select text and choose Comment or Later to queue a passage."}</p>}
    {!!resolved.length && <LazyDisclosure summary={`Resolved comments (${resolved.length})`}>{rows(resolved)}</LazyDisclosure>}
    <LazyDisclosure summary="Earlier review packets">{tasks.filter(t => t.review?.kind === "request").map(t => <button className="review-list-item" key={t.id} onClick={() => onSelect(t)}>{t.title} · {t.status}</button>)}</LazyDisclosure>
  </section>;
}
