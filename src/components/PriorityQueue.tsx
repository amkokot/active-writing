import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check, ChevronDown, LocateFixed } from "lucide-react";
import { attentionQueue, queueColorVariables, queueWarmth } from "../attention";
import { useDismissibleLayer } from "../useDismissibleLayer";
import { AttentionStrip, type AttentionStripProps } from "./AttentionStrip";
import { nextQueueTask } from "../projectQueue";

/** Separate locating the current item from advancing; neither completes work. */
export function PriorityQueue(props: AttentionStripProps & { activeId?: string; activeLabel?: string; activeChecked?: boolean; onFinishActive?: () => void; navigating?: boolean }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const root = useRef<HTMLDivElement>(null);
  const queue = attentionQueue(props.tasks, now);
  const currentTask = queue.find(task => task.id === props.activeId) ?? queue[0];
  const nextTask = nextQueueTask(queue, currentTask?.id);
  const warmth = queueWarmth(queue, now)[0] ?? 0;
  useDismissibleLayer(open, root, () => setOpen(false), ".queue-menu-button");
  const returnTo = (task: typeof queue[number]) => { setOpen(false); props.onReturn(task); };
  const next = () => { setOpen(false); props.onNext(); };
  return <div className={`priority-queue-control${queue.some(task => task.status === "ready") ? " has-ready" : ""}`} style={queueColorVariables(warmth) as CSSProperties} ref={root}>
    <button className="current-item-check" type="button" aria-label="Check active item" aria-pressed={Boolean(props.activeChecked)} disabled={!props.onFinishActive} title={props.activeLabel ?? "Choose a block or question"} onClick={props.onFinishActive}><Check size={13} /></button>
    <button className="queue-current" type="button" aria-label="Go to current priority task" disabled={props.navigating || !currentTask} title={props.navigating ? "Opening queued work…" : currentTask ? `Return to current item: ${props.taskLabel?.(currentTask) ?? currentTask.title} · does not complete it` : "No current queued item"} onClick={() => { if (currentTask) returnTo(currentTask); }}><LocateFixed size={13} /><span>Current</span></button>
    <button className="queue-main" type="button" aria-label="Next priority task" disabled={props.navigating || props.queueLoading || !nextTask && !props.suggestion} title={props.navigating ? "Opening queued work…" : props.queueLoading ? "Checking other projects…" : nextTask ? `Next in queue: ${props.taskLabel?.(nextTask) ?? nextTask.title}` : props.suggestion ? "Suggested next work" : "No other queued work"} onClick={() => {
      if (nextTask) returnTo(nextTask);
      else if (props.suggestion) next();
    }}><ArrowRight size={13} /><span>Next</span></button>
    <button className="queue-menu-button" type="button" aria-label={`Open priority queue (${queue.length} items)`} aria-haspopup="dialog" aria-expanded={open} title={`Priority queue · ${queue.length} items`} onClick={() => setOpen(value => !value)}>{queue.length > 0 && <small>{queue.length}</small>}<ChevronDown size={11} /></button>
    {open && <div className="priority-queue-menu" role="dialog" aria-label="Priority queue">
      <AttentionStrip {...props} now={now} settings={{ ...props.settings, minimized: false }} onReturn={returnTo} onNext={next} onReady={task => { setOpen(false); props.onReady(task); }} onClose={() => setOpen(false)} />
    </div>}
  </div>;
}
