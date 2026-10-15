import { useEffect, useRef } from "react";
import { IdleCompilation, type IdleCompileTarget } from "./idleCompilation";
import { useStableEvent } from "./useStableEvent";

export function useIdleCompilation(target: IdleCompileTarget, compile: () => Promise<void>) {
  const run = useStableEvent(compile);
  const controller = useRef<IdleCompilation | undefined>(undefined);
  useEffect(() => {
    const idle = new IdleCompilation(run, () => document.visibilityState === "visible" && document.hasFocus() && Boolean(window.getSelection()?.isCollapsed));
    controller.current = idle;
    const inEditor = (event: Event) => event.target instanceof Element && Boolean(event.target.closest('.manuscript-scroll, .preview-canvas, .pdf-canvas-scroll'));
    const activity = (event: Event) => { if (inEditor(event)) idle.activity(); };
    const pointerDown = (event: Event) => { if (inEditor(event)) idle.hold("pointer"); };
    const pointerUp = () => idle.release("pointer");
    const compositionStart = (event: Event) => { if (inEditor(event)) idle.hold("composition"); };
    const compositionEnd = () => idle.release("composition");
    const visibility = () => idle.activity();
    for (const name of ["scroll", "wheel", "keydown", "beforeinput"]) document.addEventListener(name, activity, { capture: true, passive: true });
    document.addEventListener("pointerdown", pointerDown, true);
    for (const name of ["pointerup", "pointercancel"]) document.addEventListener(name, pointerUp, true);
    document.addEventListener("compositionstart", compositionStart, true);
    document.addEventListener("compositionend", compositionEnd, true);
    document.addEventListener("selectionchange", visibility);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", pointerUp);
    window.addEventListener("focus", visibility);
    return () => {
      idle.dispose(); controller.current = undefined;
      for (const name of ["scroll", "wheel", "keydown", "beforeinput"]) document.removeEventListener(name, activity, true);
      document.removeEventListener("pointerdown", pointerDown, true);
      for (const name of ["pointerup", "pointercancel"]) document.removeEventListener(name, pointerUp, true);
      document.removeEventListener("compositionstart", compositionStart, true);
      document.removeEventListener("compositionend", compositionEnd, true);
      document.removeEventListener("selectionchange", visibility);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", pointerUp);
      window.removeEventListener("focus", visibility);
    };
  }, [run]);
  useEffect(() => { controller.current?.update(target); }, [target.enabled, target.projectId, target.key, target.viewKey, target.needsCompile, target.blocked, target.blockWindow]);
}
