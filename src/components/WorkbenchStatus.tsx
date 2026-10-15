import type { WorkbenchRecovery } from "../types";

interface Props {
  ready: boolean; saving: boolean; pending: boolean; error?: string;
  recoveredDrafts: WorkbenchRecovery[];
  onRecover: () => void; onRestore: (id: string) => void; onCopy: (draft: WorkbenchRecovery) => void;
  visible?: boolean;
}
export function WorkbenchStatus({ ready, saving, pending, error, recoveredDrafts, onRecover, onRestore, onCopy, visible = false }: Props) {
  const active = recoveredDrafts.filter((draft) => !draft.dismissed);
  if (!visible && !error && !active.length) return null;
  const status = error ? "Disk saving paused" : !ready ? "Loading saved work…" : saving || pending ? "Saving work…" : "Work saved to this paper";
  return <details className={`workbench-status ${error ? "has-error" : ""}`}>
    <summary><span role="status">{status}</span>{active.length > 0 && <span> · {active.length} recovered {active.length === 1 ? "draft" : "drafts"}</span>}</summary>
    <p>Tasks, replies and wording drafts save to .paperfocus/workbench.json; a previous version is kept. Notebook conversations save separately. Recovery never changes the manuscript.</p>
    {error && <p role="alert">{error} Your drafts stay in this browser; damaged files aren't overwritten.</p>}
    <button onClick={onRecover} disabled={saving}>Reload & recover</button>
    {recoveredDrafts.length > 0 && <p>Your editor stays unchanged while typing. Conflicting saved versions are kept here. Restoring a task sends nothing; check the original passage before using a restored wording draft.</p>}
    {recoveredDrafts.map((draft) => <details key={draft.id} className="workbench-recovery">
      <summary>{draft.kind === "task" ? draft.value.title : draft.kind === "rewrite" ? "Alternative wording" : draft.value.label || "Prompt draft"}{draft.dismissed ? " · copy restored" : " · recovered draft"}</summary>
      <small>{draft.createdAt} · {draft.key}</small>
      <textarea rows={6} aria-label={`Recovered ${draft.kind} ${draft.key}`} readOnly value={draft.kind === "task" ? draft.value.replyDraft || draft.value.reply || draft.value.packet || "No reply" : draft.kind === "rewrite" ? draft.value.candidates.filter((candidate) => !candidate.dismissed).map((candidate) => candidate.text).join("\n\n") : draft.value.instruction} />
      <button onClick={() => onCopy(draft)}>Copy recovered {draft.kind === "handoff" ? "prompt" : "text"}</button>
      {draft.kind !== "handoff" && !draft.dismissed && <button onClick={() => onRestore(draft.id)}>Restore a copy</button>}
      <details><summary>Saved details</summary><textarea rows={8} readOnly aria-label={`Full recovered record ${draft.key}`} value={JSON.stringify(draft.value, null, 2)} /></details>
    </details>)}
  </details>;
}
