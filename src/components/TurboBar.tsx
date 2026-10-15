import { ArrowDown, ArrowUp, Check, RotateCcw, WandSparkles, Zap } from "lucide-react";
import type { TurboState } from "../types";

interface TurboBarProps {
  turbo: TurboState;
  position: number;
  total: number;
  checked: number;
  waiting: number;
  disabled: boolean;
  onPatch: (patch: Partial<TurboState>) => void;
  onMove: (direction: "previous" | "skip" | "next" | "start" | "remaining") => void;
  onUndo: () => void;
  onPolish: () => void;
  onResume: () => void;
}

export function TurboBar({ turbo, position, total, checked, waiting, disabled, onPatch, onMove, onUndo, onPolish, onResume }: TurboBarProps) {
  return <div className="turbo-bar" aria-label="Turbo wording pass">
    <div className="turbo-heading"><Zap size={14} /><strong>Turbo</strong><span>{turbo.atEnd ? "End of pass" : `${position + 1} / ${total}`}</span><small title={`${checked} wording checks; linked tasks stay open`}>{checked} checked{waiting ? ` · ${waiting} linked` : ""}</small></div>
    {turbo.reviewingTaskId ? <div className="turbo-reply-banner"><span>Reviewing a reply. Your place in the pass is saved.</span><button onClick={onResume}>Finish review &amp; resume</button></div> : <div className="turbo-controls">
      <button aria-label="Previous paragraph" title="Previous — does not check anything" disabled={disabled || position === 0} onClick={() => onMove("previous")}><ArrowUp size={14} /></button>
      <button className="turbo-next" disabled={disabled || !total || turbo.atEnd} onClick={() => onMove("next")}><Check size={14} /> Check &amp; next <ArrowDown size={13} /></button>
      <button disabled={disabled || !total || turbo.atEnd} onClick={() => onMove("skip")}>Skip</button>
      <button aria-label="Undo wording check" title="Undo the last check, not your edits" disabled={disabled || !turbo.history.length} onClick={onUndo}><RotateCcw size={13} /></button>
      <button aria-label="Rephrase active paragraph" title="Rephrase this paragraph" disabled={disabled || !total || turbo.atEnd} onClick={onPolish}><WandSparkles size={14} /></button>
      {turbo.atEnd && checked < total && <button onClick={() => onMove("remaining")}>Review remaining</button>}
    </div>}
    <details className="turbo-options"><summary>Options</summary>
      <div>
        <label>Look ahead <select aria-label="Turbo look ahead" value={turbo.context} onChange={(event) => onPatch({ context: Number(event.target.value) })}><option value={0}>Compact · source 0 / preview 2</option><option value={1}>Standard · source 1 / preview 3</option><option value={2}>Wide · source 2 / preview 4</option></select></label>
        <label><input type="checkbox" checked={turbo.autoCheck} onChange={(event) => onPatch({ autoCheck: event.target.checked })} /> Scroll forward to check</label>
        <label><input type="checkbox" checked={turbo.includeTechnical} onChange={(event) => onPatch({ includeTechnical: event.target.checked, atEnd: false })} /> Include LaTeX blocks and opening pages</label>
        <button disabled={disabled || !total} onClick={() => onMove("start")}>Start of paper</button>
      </div>
      <p>One previous block stays as context. Forward scrolling checks wording, not proofs; backward scrolling and fast jumps don't check skipped text. Linked work stays open. Edited wording needs rechecking. Compile builds this preview window only; navigation never recompiles a PDF.</p>
    </details>
    <progress aria-label="Wording pass progress" value={checked} max={Math.max(1, total)} />
  </div>;
}
