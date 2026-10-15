import { useEffect, type RefObject } from "react";
import { useStableEvent } from "./useStableEvent";

/** Small toolbar panels close when left, without trapping focus or changing drafts. */
export function useDismissibleLayer(open: boolean, root: RefObject<HTMLElement | null>, onClose: () => void, triggerSelector = "button") {
  const close = useStableEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const layer = root.current;
    if (layer) layer.dataset.dismissibleLayer = "open";
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape" || !(event.target instanceof Element) || !root.current?.contains(event.target)) return;
      if (event.target.closest('[data-dismissible-layer="open"]') !== root.current) return;
      event.preventDefault();
      close();
      root.current?.querySelector<HTMLElement>(triggerSelector)?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      if (layer) delete layer.dataset.dismissibleLayer;
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, root, close, triggerSelector]);
}
