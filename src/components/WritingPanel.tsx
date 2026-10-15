import { ArrowLeft, ArrowRight, SquarePen, X } from "lucide-react";
import { useState } from "react";
import type { AttentionTask, ProjectDocument, ThemeLens, WritingScope } from "../types";
import { writingReviewText, writingTarget } from "../writing";
import RenderedPassage from "./RenderedPassage";
import { LazyDisclosure } from "../lazyDisclosure";
import { manuscriptPurpose } from "../manuscripts";

export function WritingPanel({ tasks, document, edits, selectedId, instruction, theme, busy, onClose, onSelect, onInstruction, onPrepare, onFullNote, onImport, onReplyDraft, onDraft, onPlace, onEdit, onAccept, onDrop, onTogether, onNextWork, onCopy, onFinishRound, onUnlock, onFeedback }: {
  tasks: AttentionTask[]; document: ProjectDocument; edits: Record<string, string>; selectedId?: string; instruction: string; theme?: ThemeLens; busy: boolean;
  onClose: () => void; onSelect: (task: AttentionTask) => void; onInstruction: (text: string) => void;
  onPrepare: (scope: WritingScope, route: "codex" | "chatgpt", previousRoundId?: string) => Promise<void>;
  onFullNote: (instruction: string) => void;
  onImport: (id: string, reply: string) => void; onReplyDraft: (id: string, text: string) => void; onDraft: (id: string, text: string) => void;
  onPlace: (id: string) => Promise<void>; onEdit: (paragraphId: string, text: string) => void; onAccept: (id: string, text: string) => Promise<void>; onDrop: (id: string) => Promise<void>;
  onTogether: (roundId: string) => void; onNextWork: (task?: AttentionTask) => void; onCopy: (task: AttentionTask) => void; onFinishRound: (id: string) => void;
  onUnlock: (id: string) => void;
  onFeedback: (id: string, feedback: string) => void;
}) {
  const [scope, setScope] = useState<WritingScope>(theme ? "theme" : "section"), [route, setRoute] = useState<"codex" | "chatgpt">("codex");
  const [notice, setNotice] = useState(""), [curated, setCurated] = useState("");
  const selected = tasks.find(t => t.id === selectedId && t.writing);
  const roundId = selected?.writing?.kind === "paragraph" ? selected.writing.roundId : selected?.id;
  const request = tasks.find(t => t.id === roundId && t.writing?.kind === "request");
  const round = tasks.filter(t => t.writing?.kind === "paragraph" && t.writing.roundId === request?.id);
  const pending = round.filter(t => t.status !== "reviewed");
  const paragraph = selected?.writing?.kind === "paragraph" ? selected : pending[0];
  const w = paragraph?.writing?.kind === "paragraph" ? paragraph.writing : undefined;
  const target = paragraph && writingTarget(paragraph, document, edits);
  const text = paragraph && writingReviewText(paragraph, document, edits);
  const key = paragraph && text !== undefined ? JSON.stringify([paragraph.id, text]) : "";
  const move = (direction: -1 | 1) => { const list = pending.length ? pending : round; const index = list.findIndex(t => t.id === paragraph?.id); if (list.length) onSelect(list[(index + direction + list.length) % list.length]); };
  async function action(work: () => Promise<void>) { setNotice(""); try { await work(); setCurated(""); } catch (error) { setNotice((error as Error).message); } }
  return <section className="writing-panel" aria-label="Guided writing">
    <header className="inspector-header"><h2><SquarePen size={17} /> Writing</h2><button aria-label="Close writing" onClick={onClose}><X size={16} /></button></header>
    <p className="writing-caption">{manuscriptPurpose(document.project) === "overview" ? "Keep this overview short and explanatory for collaborators. Use Ask for a coherent brief, or choose optional small-step review below. Existing locks stay intact." : manuscriptPurpose(document.project) === "notes" ? "Research notes can be written as a full explanation. Use Ask for that, or choose a small reviewed step below. Existing reviews and locks stay intact." : "One idea, a few connected paragraphs. Drafts can go into the paper; each stays queued until you review it."}</p>
    {request && <>
      <div className="writing-round-heading"><strong>{request.title.replace(/^Writing · /, "")}</strong><small>{pending.length} of {round.length} paragraphs need review</small></div>
      {request.writing?.kind === "request" && request.writing.connection && <p className="writing-connection">{request.writing.connection}</p>}
      {!!round.length && <div className="review-actions"><button onClick={() => onTogether(request.id)}>See passages together</button><button onClick={() => onSelect(request)}>Round details</button></div>}
      {!!round.length && <details><summary>Paragraphs in this round</summary>{round.map(t => <button className="review-list-item" key={t.id} onClick={() => onSelect(t)}>{t.writing?.kind === "paragraph" && t.writing.purpose} · {t.status === "reviewed" ? "reviewed / set aside" : "needs review"}</button>)}</details>}
      {!request.reply && <div className="review-actions"><button disabled={busy} onClick={() => onCopy(request)}>Copy instructions</button><button onClick={() => onNextWork(request)}>Work elsewhere while waiting →</button></div>}
      {request.error && <p role="alert">{request.error}</p>}
      {!request.reply && <LazyDisclosure summary="Paste proposed paragraphs"><textarea aria-label="Writing reply" rows={5} value={request.replyDraft ?? ""} maxLength={40000} onChange={e => onReplyDraft(request.id, e.target.value)} onPaste={e => {
        const pasted = e.clipboardData.getData("text/plain"), field = e.currentTarget; if (pasted.trim()) { e.preventDefault(); onImport(request.id, field.value.slice(0, field.selectionStart) + pasted + field.value.slice(field.selectionEnd)); }
      }} /><div className="review-actions"><button onClick={() => onImport(request.id, request.replyDraft ?? "")}>Read proposals</button><button onClick={() => void navigator.clipboard.readText().then(reply => onImport(request.id, reply), () => setNotice("Use Ctrl+V in Writing reply."))}>Paste from clipboard</button></div></LazyDisclosure>}
    </>}
    {paragraph && w && <article className="writing-paragraph" aria-label="Current writing paragraph">
      <nav className="review-navigation" aria-label="Writing paragraphs"><button aria-label="Previous writing paragraph" onClick={() => move(-1)}><ArrowLeft size={14} /></button><span>{round.indexOf(paragraph) + 1} / {round.length} · {w.decision === "accepted" ? "Reviewed" : w.decision === "dropped" ? "Set aside" : w.placement ? "In manuscript · needs review" : "Proposed wording"}</span><button aria-label="Next writing paragraph" onClick={() => move(1)}><ArrowRight size={14} /></button></nav>
      <h3>{w.purpose}</h3><p className="writing-caption">{w.rationale}</p>
      <small>{paragraph.sourceSnapshot?.nodeTitle} · {paragraph.sourceSnapshot?.paragraphs[0]?.file} · {w.action === "replace" ? "Replace paragraph" : `Add ${w.action} paragraph`}</small>
      <LazyDisclosure summary="Original wording"><RenderedPassage text={w.placement?.before ?? paragraph.sourceSnapshot?.paragraphs[0]?.text ?? ""} /></LazyDisclosure>
      {w.placement ? <>
        <label>Current manuscript text<textarea aria-label="Writing manuscript text" rows={7} value={text ?? w.placement.text} disabled={!target || busy || !!w.decision} onChange={e => { if (target) onEdit(target.id, e.target.value); setCurated(""); }} /></label>
        {!target && <p role="status">The passage changed or moved in another editor. This review is kept; no location is guessed. Open the current text and request a fresh round.</p>}
        {text !== undefined && <div className="writing-reading"><RenderedPassage text={text} /></div>}
        {!w.decision && <><label className="writing-curation"><input type="checkbox" checked={!!key && curated === key} disabled={!key || busy} onChange={e => setCurated(e.target.checked ? key : "")} /> I reviewed every word and checked the claim.</label><div className="review-actions"><button className="primary-button" disabled={busy || !key || curated !== key} onClick={() => void action(() => onAccept(paragraph.id, text!))}>Approve this paragraph</button><button disabled={busy} onClick={() => void action(() => onDrop(paragraph.id))}>Undo draft</button></div></>}
        {w.decision === "accepted" && <><small>{w.unlockedAt ? "Unlocked for further proposals." : "Locked · future rounds may read this, not rewrite it."} Human review is not mathematical verification.</small>{!w.unlockedAt && <button onClick={() => onUnlock(paragraph.id)}>Unlock for another pass</button>}</>}
      </> : <>
        <textarea aria-label="Proposed writing text" rows={7} maxLength={6000} value={w.draftText} disabled={!!w.decision || busy} onChange={e => onDraft(paragraph.id, e.target.value)} />
        <div className="writing-reading"><RenderedPassage text={w.draftText} /></div>
        {!w.decision && <div className="review-actions"><button className="primary-button" disabled={busy || !target || !w.draftText.trim()} onClick={() => void action(() => onPlace(paragraph.id))}>Place draft in manuscript</button><button disabled={busy} onClick={() => void action(() => onDrop(paragraph.id))}>Set aside</button></div>}
      </>}
      <small>Nothing is approved by scrolling, receiving an answer, or pressing Queue ✓.</small>
      <LazyDisclosure summary="Guidance for the next pass · optional"><textarea aria-label="Writing feedback" rows={3} maxLength={2000} value={w.feedback ?? ""} placeholder="A reason to keep or reject this idea, a phrase to preserve, or a better direction. Saved as you type." onChange={e => onFeedback(paragraph.id, e.target.value)} /></LazyDisclosure>
    </article>}
    {request?.reply && !pending.length && <div className="writing-round-end"><p>Round reviewed. Read the transitions before taking another small step.</p>{request.writing?.kind === "request" && <p>{request.writing.nextStep}</p>}<button disabled={busy || request.status === "reviewed"} onClick={() => onFinishRound(request.id)}>Finish round · keep history</button></div>}
    <details open={!request} className="writing-compose"><summary>{request ? "Next writing step" : "Describe the change"}</summary>
      <label>What should change?<textarea aria-label="Writing instructions" rows={5} maxLength={6000} placeholder="Describe the idea, the reader, what to preserve, and how it should connect to nearby or distant passages." value={instruction} onChange={e => onInstruction(e.target.value)} /></label>
      {manuscriptPurpose(document.project) !== "publication" && <button disabled={busy || !instruction.trim()} onClick={() => onFullNote(instruction)}>{manuscriptPurpose(document.project) === "overview" ? "Ask for a short overview" : "Ask for a full research note"}</button>}
      <label>Context<select aria-label="Writing context" value={scope} onChange={e => setScope(e.target.value as WritingScope)}><option value="paragraph">Active paragraph</option><option value="section">This section</option><option value="theme" disabled={!theme}>Current theme{theme ? ` · ${theme.name}` : ""}</option><option value="paper">Across the paper · context, not a full draft</option></select></label>
      <label>Assistant<select aria-label="Writing assistant" value={route} onChange={e => setRoute(e.target.value as typeof route)}><option value="codex">Shared-folder assistant</option><option value="chatgpt">Any web chat</option></select></label>
      <button className="primary-button" disabled={busy || !instruction.trim() || !!pending.length} onClick={() => void action(() => onPrepare(scope, route, request?.id))}>Prepare a small writing round</button>
      <small>{pending.length ? "Review or set aside this round's paragraphs first." : "Nothing is sent automatically. Each reply is limited to three short paragraphs."}</small>
    </details>
    {notice && <p role="status">{notice}</p>}
    <LazyDisclosure summary="Writing history">{tasks.filter(t => t.writing?.kind === "request").map(t => <button className="review-list-item" key={t.id} onClick={() => onSelect(t)}>{t.title} · {t.status}</button>)}</LazyDisclosure>
  </section>;
}
