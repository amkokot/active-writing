import { useEffect, useRef, type WheelEvent } from "react";
import { sectionEdgeStep, type SectionEdgeIntent } from "./manuscriptView";

export interface SectionNavigation {key: string; previous?: string; next?: string; blocked: boolean; onMove: (direction: -1 | 1) => void}
export function useSectionEdges(navigation?: SectionNavigation) {
  const intent = useRef<SectionEdgeIntent>({at: 0, started: 0, amount: 0, sign: 0, armed: false, cooldown: 0});
  useEffect(() => { intent.current = {...intent.current, at: performance.now(), amount: 0, armed: false}; }, [navigation?.key]);
  return (event: WheelEvent<HTMLDivElement>) => {
    if (!navigation) return;
    const pane = event.currentTarget;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1);
    const field = (event.target as Element).closest("textarea, select, input");
    // A heading's auto-sized textarea has no scroll of its own: hovering it
    // should not make the section edge gesture mysteriously stop working.
    const fieldConsumes = field instanceof HTMLTextAreaElement ? field.scrollHeight > field.clientHeight + 2 &&
      (delta < 0 ? field.scrollTop > 2 : field.scrollTop + field.clientHeight < field.scrollHeight - 2) : !!field;
    const step = sectionEdgeStep(intent.current, {now: performance.now(), delta,
      atEdge: delta < 0 ? pane.scrollTop <= 2 : pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2,
      allowed: delta < 0 ? !!navigation.previous : !!navigation.next,
      blocked: navigation.blocked || fieldConsumes || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || window.getSelection()?.isCollapsed === false});
    intent.current = step.intent;
    if (step.direction) navigation.onMove(step.direction as -1 | 1);
  };
}
