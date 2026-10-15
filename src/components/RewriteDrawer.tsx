import {
  Bot,
  ChevronLeft,
  Cpu,
  MessageSquareText,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { effortLabels, routeLabels } from "../rewrite";
import type { AttentionTask, RewriteCandidate, RewriteRoute, RewriteSession } from "../types";
import { LocalModelPicker } from "./LocalModelPicker";
import { sourceChunks } from "../sourceChunks";

interface RewriteDrawerProps {
  session: RewriteSession;
  onClose: () => void;
  onUpdate: (updates: Partial<RewriteSession>) => void;
  onUpdateCandidate: (candidateId: string, updates: Partial<RewriteCandidate>) => void;
  onAddCandidate: () => void;
  onGenerateRules: () => void;
  onDispatch: () => void;
  onApply: () => void;
  onCheckSource: () => void;
  savedSessions: RewriteSession[];
  onOpenSession: (id: string) => void;
  dispatching?: boolean;
  task?: AttentionTask;
  onCopyTask: (task: AttentionTask) => void;
  onReplyTask: (task: AttentionTask) => void;
}

const routeIcons: Record<RewriteRoute, typeof Sparkles> = {
  rules: Sparkles,
  local: Cpu,
  codex: Bot,
  chatgpt: MessageSquareText,
};

const routeDescriptions: Record<RewriteRoute, string> = {
  rules: "Immediate · free",
  local: "Runs on this computer",
  codex: "Reply via a shared folder",
  chatgpt: "Paste into any chat",
};

export function RewriteDrawer({
  session,
  onClose,
  onUpdate,
  onUpdateCandidate,
  onAddCandidate,
  onGenerateRules,
  onDispatch,
  onApply,
  onCheckSource,
  savedSessions,
  onOpenSession,
  dispatching,
  task,
  onCopyTask,
  onReplyTask,
}: RewriteDrawerProps) {
  const labels = effortLabels[session.route];
  const effortIndex = Math.min(session.effortByRoute[session.route], labels.length - 1);
  const activeCandidates = session.candidates.filter((candidate) => !candidate.dismissed);
  const selectedCandidate = activeCandidates.find(candidate => candidate.id === session.selectedCandidateId);
  const wrongBlockCount = !!session.selectionSpans && !!selectedCandidate && sourceChunks(selectedCandidate.text).length !== session.selectionSpans.length;

  const setRoute = (route: RewriteRoute) => onUpdate({ route });
  const setEffort = (effort: number) =>
    onUpdate({ effortByRoute: { ...session.effortByRoute, [session.route]: effort } });

  return (
    <aside className="rewrite-drawer" aria-label="Alternative wording">
      <div className="drawer-heading">
        <button className="icon-control" onClick={onClose} aria-label="Close alternatives">
          <ChevronLeft size={17} />
        </button>
        <div>
          <strong>Reword this passage</strong>
          <span>{session.status === "stale" ? "Check the passage before replacing it" : "Draft is saved automatically"}</span>
        </div>
      </div>

      {session.selectionSpans && <p className="rewrite-block-count">{session.selectionSpans.length} selected blocks · keep one replacement per block, separated by blank lines.</p>}

      {savedSessions.length > 1 && <details className="rewrite-saved-versions"><summary>Saved drafts ({savedSessions.length})</summary>{savedSessions.map((saved, index) => <button key={saved.id} aria-pressed={saved.id === session.id} onClick={() => onOpenSession(saved.id)}>Draft {index + 1} · {saved.sourceText.slice(0, 65)} · {saved.candidates.filter((c) => !c.dismissed).length} alternatives{saved.status === "stale" ? " · needs source check" : ""}</button>)}</details>}
      {session.status === "stale" && <div className="connector-note">The original passage and all alternatives are kept. Check that the passage still matches before replacing it.<button onClick={onCheckSource}>Check passage</button></div>}

      <label className="field-label" htmlFor="rewrite-instruction">Direction</label>
      <input
        id="rewrite-instruction"
        className="text-field"
        value={session.instruction}
        onChange={(event) => onUpdate({ instruction: event.target.value })}
      />

      <div className="field-label route-label-row">
        <span>Get suggestions</span>
        <small>{routeDescriptions[session.route]}</small>
      </div>
      <div className="route-selector" aria-label="Suggestion source">
        {(Object.keys(routeLabels) as RewriteRoute[]).map((route) => {
          const Icon = routeIcons[route];
          return (
            <button
              key={route}
              className={session.route === route ? "is-active" : ""}
              onClick={() => setRoute(route)}
            >
              <Icon size={14} />
              {routeLabels[route]}
            </button>
          );
        })}
      </div>

      <div className="field-label route-label-row">
        <span>Effort</span>
        <strong>{labels[effortIndex]}</strong>
      </div>
      <div className="effort-selector" aria-label={`${routeLabels[session.route]} effort`}>
        {labels.map((label, index) => (
          <button
            key={label}
            className={effortIndex === index ? "is-active" : ""}
            onClick={() => setEffort(index)}
          >
            {label}
          </button>
        ))}
      </div>

      {session.route !== "rules" && (
        <div className="connector-note">
          {session.route === "local" && "Runs on this computer. Longer replies aren't necessarily better. Check alternatives before using them."}
          {session.route === "codex" && "Use a coding assistant with access to the paper folder. Replies appear here when its file is saved; nothing starts automatically."}
          {session.route === "chatgpt" && "Paste the prompt into any chat and choose a model there. Paste its reply here through Linked prompts."}
        </div>
      )}
      {session.route === "local" && <LocalModelPicker model={session.localModel} effort={effortIndex} onChange={(localModel) => onUpdate({ localModel })} />}
      {task && <div className="rewrite-linked-task"><strong>{task.status === "failed" ? "Request did not finish" : task.status === "ready" ? "Reply ready to review" : task.localJobId ? "Working on this computer" : "Prompt saved for another app"}</strong><span>{task.error ?? (task.localJobId ? "Alternatives are saved here. Keep working while you wait; check them before replacing text." : "Replies in the suggested JSON format become alternatives if math and LaTeX match. Otherwise, use Add your own phrasing.")}</span>{task.packet && <button onClick={() => onCopyTask(task)}>Copy prompt</button>}{!task.localJobId && <button onClick={() => onReplyTask(task)}>{task.reply ? "View reply" : "Paste a reply"}</button>}<small>{task.handoffPath}</small></div>}

      <div className="candidate-heading">
        <span>Alternatives</span>
        <small>{activeCandidates.length} saved</small>
      </div>
      <div className="candidate-list">
        {!activeCandidates.length && <p className="no-rule-candidates">No quick suggestion. Add your wording or choose another option; LaTeX is kept intact.</p>}
        {activeCandidates.map((candidate) => (
          <div
            className={`candidate-card ${session.selectedCandidateId === candidate.id ? "is-selected" : ""}`}
            key={candidate.id}
          >
            <button
              className="candidate-select"
              onClick={() => onUpdate({ selectedCandidateId: candidate.id })}
              aria-label={`Select alternative from ${candidate.source}`}
            >
              <span className="candidate-radio" />
              <small>{candidate.source}</small>
            </button>
            <textarea
              value={candidate.text}
              onFocus={() => onUpdate({ selectedCandidateId: candidate.id })}
              onChange={(event) =>
                onUpdateCandidate(candidate.id, { text: event.target.value, userEdited: true })
              }
              aria-label={`Alternative from ${candidate.source}`}
            />
            <button
              className="candidate-remove"
              aria-label="Remove alternative"
              onClick={() => onUpdateCandidate(candidate.id, { dismissed: true })}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="add-candidate" onClick={onAddCandidate}>
          <Plus size={15} /> Add your own phrasing
        </button>
      </div>

      <div className="drawer-actions">
        {session.route === "rules" ? (
          <button className="secondary-button" onClick={onGenerateRules}>
            <RefreshCw size={15} /> More
          </button>
        ) : (
          <button className="secondary-button" disabled={dispatching || session.status === "stale"} onClick={onDispatch}>
            <Bot size={15} /> {dispatching ? "Preparing…" : task && task.status !== "failed" ? "Continue pass" : session.route === "local" ? "Ask & continue" : "Copy prompt & continue"}
          </button>
        )}
        <button
          className="primary-button"
          onClick={onApply}
          disabled={!selectedCandidate || wrongBlockCount || session.status === "stale" || dispatching}
        >
          <WandSparkles size={15} /> Replace selection
        </button>
      </div>
      {wrongBlockCount && <p className="connector-note">Keep {session.selectionSpans!.length} blocks, separated by blank lines, before replacing.</p>}
    </aside>
  );
}
