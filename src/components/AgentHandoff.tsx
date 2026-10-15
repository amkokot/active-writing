import { useMemo, useState } from "react";
import { Bot, CheckCircle2, Copy, FileCode2, Send, X } from "lucide-react";
import type { AttentionTask, HandoffDraft, HandoffTicket, ManuscriptNode, Paragraph, ProjectDocument, TaskSourceSnapshot } from "../types";
import { handoffContext, handoffContinuation, thinkingLevels } from "../workspaceTools";
import { exportHandoff } from "../handoffs";
import { handoffExcerptSummary, prepareSourceHandoff } from "../taskSource";

type HandoffMode = "chatgpt" | "codex";

interface AgentHandoffProps {
  projectId: string;
  document: ProjectDocument;
  projectFolder?: string;
  mainFile?: string;
  mode: HandoffMode;
  node: ManuscriptNode;
  nodes: ManuscriptNode[];
  paragraphId?: string;
  draft: HandoffDraft;
  previousTask?: AttentionTask;
  onPatch: (patch: Partial<HandoffDraft>) => void;
  paragraphs: Paragraph[];
  paragraphEdits: Record<string, string>;
  onClose: () => void;
  onDispatch: (ticket: HandoffTicket, effort: string, packet: string, snapshot?: TaskSourceSnapshot) => void;
}

const efforts = thinkingLevels;

export function AgentHandoff({
  projectId,
  document,
  projectFolder = "demo-paper",
  mainFile = "main.tex",
  mode,
  node,
  nodes,
  paragraphId,
  draft,
  previousTask,
  onPatch,
  paragraphs,
  paragraphEdits,
  onClose,
  onDispatch,
}: AgentHandoffProps) {
  const { effort, scope, includeProject, instruction } = draft;
  const [savedPath, setSavedPath] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const sectionText = handoffContext(node, nodes, paragraphs, paragraphEdits, scope, paragraphId);
  const source = useMemo(() => prepareSourceHandoff(document, node, paragraphEdits, draft, paragraphId, previousTask?.sourceSnapshot), [document, node, paragraphEdits, draft.scope, draft.contextMode, paragraphId, previousTask?.sourceSnapshot]);
  const focusTitle = (scope === "auto" || scope === "none") && previousTask?.sourceSnapshot ? previousTask.sourceSnapshot.nodeTitle : `${node.number ? `${node.number} ` : ""}${node.title}`;

  const packet = useMemo(() => {
    const parts = [
      draft.contextMode === "briefing" ? "# Active Writing · new conversation" : "Continue our manuscript work; use the conversation history for unchanged context.",
      "",
      `- Effort: ${efforts[effort]}`,
      `- Focus: ${focusTitle}`,
      "",
      "## Task",
      "",
      instruction.trim(),
    ];
    const continuation = handoffContinuation(previousTask, mode, draft.contextMode);
    if (continuation) parts.push("", continuation);
    if (scope === "auto") { if (source.context) parts.push("", source.context); }
    else if (scope !== "none") parts.push("", `## Focused ${scope}`, "", sectionText);
    if (includeProject) {
      parts.push(
        "",
        "## Project context",
        "",
        `Project folder: ${projectFolder}/. Root: ${mainFile}. ${mode === "codex" ? "A coding assistant can read these files if you give it folder access." : "A separate chat cannot read this folder automatically. Attach needed files there, or use the excerpt above."}`,
        "",
        "Aw notes and generated builds live outside this repository, in Aw home's `.paperfocus/project-data/` folder. Keep them out of Git and Overleaf unless the author explicitly chooses an export.",
      );
    }
    parts.push(
      "",
      "## Constraints",
      "",
      "Keep the project conventionally compilable in Overleaf. Do not introduce Active Writing-specific LaTeX macros or conditional rendering into shared source files.",
    );
    return parts.join("\n");
  }, [effort, includeProject, scope, instruction, mode, focusTitle, sectionText, projectFolder, mainFile, draft.contextMode, previousTask, source.context]);

  async function copyPacket() {
    try {
      await navigator.clipboard.writeText(packet);
      setError(undefined);
    } catch {
      setError("Clipboard unavailable. Select the prompt below to copy it.");
    }
  }

  async function saveAndDispatch() {
    setSaving(true);
    setError(undefined);
    try {
      const ticket = await exportHandoff(projectId, packet, mode, { label: draft.label });
      setSavedPath(ticket.promptPath);
      try { await navigator.clipboard.writeText(ticket.copyText); } catch { /* Saved prompt remains accessible through Linked prompts. */ }
      onDispatch(ticket, efforts[effort], packet, source.snapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="handoff-drawer">
      <div className="drawer-heading">
        <button className="icon-control" onClick={onClose} aria-label="Close prompt"><X size={16} /></button>
        <div>
          <strong>{mode === "chatgpt" ? "Copy to chat" : "Use a coding assistant"}</strong>
          <span>Draft saved · nothing sent automatically</span>
        </div>
      </div>

      <div className="handoff-scroll">
        {previousTask && <p className="handoff-reply-note">Follow-up to {previousTask.title}. {scope === "auto" ? draft.contextMode === "briefing" ? "The current passage is included for the new conversation." : "Only changed text is included." : "The selected passage is included."} Choose New conversation if the other app has no history.</p>}
        {previousTask && <p className={`source-check-note ${(scope === "auto" || scope === "none") && (source.check.status !== "unchanged" || source.check.locationUnverified) ? "needs-attention" : ""}`} role="status">{scope === "auto" || scope === "none" ? source.check.message : "This passage starts a new source link. Earlier replies stay saved and aren't revised."}{scope === "none" ? " No new passage is included." : ""}</p>}
        <label className="field-label" htmlFor="handoff-instruction">Task</label>
        <textarea
          id="handoff-instruction"
          className="handoff-instruction"
          value={instruction}
          onChange={(event) => onPatch({ instruction: event.target.value })}
        />

        <div className="field-label route-label-row"><span>Requested effort</span><strong>{efforts[effort]}</strong></div>
        <div className="effort-selector">
          {efforts.map((label, index) => (
            <button className={effort === index ? "is-active" : ""} key={label} onClick={() => onPatch({ effort: index })}>{label}</button>
          ))}
        </div>

        <div className="field-label">Include</div>
        <label className="handoff-check handoff-field">App name · optional<input aria-label="Other app name" maxLength={100} value={draft.label ?? ""} placeholder="App name" onChange={(event) => onPatch({ label: event.target.value })} /></label>
        <label className="handoff-check handoff-field">Conversation<select aria-label="Conversation to use" value={draft.contextMode ?? "continuation"} onChange={(event) => onPatch({ contextMode: event.target.value as HandoffDraft["contextMode"] })}><option value="continuation">Existing conversation · short prompt</option><option value="briefing">New conversation · include background</option></select></label>
        <label className="handoff-check"><FileCode2 size={14} /><select aria-label="Passage to include" value={scope} onChange={(event) => onPatch({ scope: event.target.value as HandoffDraft["scope"] })}><option value="auto" disabled={!previousTask}>{draft.contextMode === "briefing" ? "Current passage · automatic" : "Changed text only · automatic"}</option><option value="paragraph" disabled={!paragraphId}>Active paragraph</option><option value="section">Section with results and proofs</option><option value="none">No new passage</option></select></label>
        <label className="handoff-check">
          <input type="checkbox" checked={includeProject} onChange={(event) => onPatch({ includeProject: event.target.checked })} />
          <span><Bot size={14} /><strong>Project location</strong><small>{mode === "codex" ? "Assistant can read the shared folder" : "Attach files in your chat when needed"}</small></span>
        </label>
        <p className="handoff-model-note" role="status">{handoffExcerptSummary(scope, scope === "auto" ? source.context : sectionText, source.snapshot)}</p>
        <p className="handoff-model-note">Choose a model and effort level in your other app. These buttons only describe the request; nothing is sent automatically.</p>

        <details className="handoff-packet">
          <summary>Preview prompt</summary>
          <pre>{packet}</pre>
        </details>

        {error && <p className="handoff-error" role="alert">{error}</p>}
        {savedPath && <p className="handoff-saved"><CheckCircle2 size={14} /> Saved to {savedPath}</p>}
      </div>

      <div className="handoff-actions">
        <button className="secondary-button" onClick={() => void copyPacket()}><Copy size={14} /> Copy draft</button>
        <button className="primary-button" disabled={saving || !instruction.trim()} onClick={() => void saveAndDispatch()}>
          <Send size={14} /> {saving ? "Preparing…" : "Copy & continue"}
        </button>
      </div>
    </aside>
  );
}
