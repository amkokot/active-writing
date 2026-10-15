import { X } from "lucide-react";
import type { ProjectDocument } from "../types";
import type { SourceDraftCopy, sourceRefreshPlan } from "../sourceRefresh";

interface Props {
  before: ProjectDocument;
  incoming?: ProjectDocument;
  plan?: ReturnType<typeof sourceRefreshPlan>;
  copies: SourceDraftCopy[];
  busy: boolean;
  error?: string;
  onClose: () => void;
  onCheck: () => void;
  onRefresh: () => void;
  onCopy: (text: string) => void;
}
const reasons = { changed: "Source changed at this position", missing: "Original passage no longer found", ambiguous: "Repeated text — location uncertain", "unknown-base": "Saved version could not be confirmed" };
export function SourceRefresh({ before, incoming, plan, copies, busy, error, onClose, onCheck, onRefresh, onCopy }: Props) {
  const changed = incoming && incoming.revision !== before.revision;
  return <section className="source-refresh-panel" aria-label="Source changes">
    <div className="source-refresh-heading"><strong>{changed ? "Files changed outside this editor" : "Draft recovery"}</strong><button aria-label="Close source changes" onClick={onClose}><X size={15} /></button></div>
    <p>{changed ? "Refresh here. Edits to unchanged passages, saved replies and waiting tasks are kept." : plan?.conflicts.length ? "An unfinished draft has a different saved version. Compare it with the current source before continuing." : "Check edits made in other apps. This doesn't pull from GitHub or Overleaf, compile, or change the paper."}</p>
    {error && <p role="alert">{error} Your current editor and drafts have not been replaced.</p>}
    {incoming && !changed && !plan?.conflicts.length && <small>The saved source is up to date.</small>}
    {plan && changed && <p>{Object.keys(plan.rebasedEdits).length} unfinished {Object.keys(plan.rebasedEdits).length === 1 ? "edit can" : "edits can"} stay in place.
      {plan.conflicts.length > 0 && <> {plan.conflicts.length} overlapping or uncertain {plan.conflicts.length === 1 ? "draft will" : "drafts will"} be saved separately to disk before refreshing. They will not be applied to incoming text.</>}</p>}
    <div className="source-refresh-actions"><button disabled={busy} onClick={onCheck}>{busy ? "Checking…" : "Check files again"}</button>
      {incoming && (changed || Boolean(plan?.conflicts.length)) && <button className="source-refresh-primary" disabled={busy} onClick={onRefresh}>{plan?.conflicts.length ? "Save draft copy & refresh" : "Refresh source"}</button>}</div>
    {plan?.conflicts.map((draft) => <details key={draft.paragraphId} open><summary>{draft.file ?? "Unsaved passage"} · {reasons[draft.reason]}</summary>
      <div className="source-conflict-versions">
        <label>Your unfinished edit<textarea readOnly rows={3} value={draft.draftText} /></label>
        {incoming?.paragraphs.find((p) => p.id === draft.paragraphId && p.file === draft.file) && <label>New text at the old position · may be a different passage<textarea readOnly rows={3} value={incoming.paragraphs.find((p) => p.id === draft.paragraphId && p.file === draft.file)!.text} /></label>}
      </div>
      <button onClick={() => onCopy(draft.draftText)}>Copy draft text</button>
      {draft.baseText !== undefined && <details><summary>{draft.reason === "unknown-base" ? "Source read from disk · original version unknown" : "Previously saved source"}</summary><textarea aria-label="Source before these edits" readOnly rows={3} value={draft.baseText} /></details>}
      <small>Nothing is merged automatically: text at the same position may be a different passage.</small>
    </details>)}
    {copies.length > 0 && <details className="source-draft-copies"><summary>Saved draft copies · {copies.length}</summary>
      <p>Kept across reloads. Copy a draft into the passage you choose; nothing is reapplied automatically.</p>
      {copies.map((copy) => <details key={copy.id}><summary>{new Date(copy.createdAt).toLocaleString()} · {copy.drafts.length} {copy.drafts.length === 1 ? "draft" : "drafts"}</summary>
        {copy.drafts.map((draft) => <div key={draft.paragraphId}><small>{draft.file ?? copy.rootFile} · {reasons[draft.reason]}</small><textarea aria-label="Saved source draft" rows={4} readOnly value={draft.draftText} /><button onClick={() => onCopy(draft.draftText)}>Copy saved draft</button></div>)}
        <details><summary>Original text & saved details</summary><textarea rows={6} readOnly aria-label="Source draft recovery record" value={JSON.stringify(copy, null, 2)} /></details>
      </details>)}
    </details>}
  </section>;
}
