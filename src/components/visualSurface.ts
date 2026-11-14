import { useEffect, useRef, useState } from "react";

export function saveVisual(value: BlobPart, filename: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type })), a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** No animation, resize work or canvas drawing when the display is offscreen. */
export function useVisualSurface() {
  const ref = useRef<HTMLElement>(null), [visible, setVisible] = useState(false), [width, setWidth] = useState(600), [theme, setTheme] = useState(0);
  useEffect(() => {
    const element = ref.current; if (!element) return;
    let intersects = false;
    const update = () => setVisible(intersects && document.visibilityState === "visible");
    const observer = new IntersectionObserver(entries => { intersects = entries[0].isIntersecting; update(); });
    observer.observe(element); document.addEventListener("visibilitychange", update);
    const resize = new ResizeObserver(() => setWidth(Math.max(240, element.clientWidth))); resize.observe(element);
    const colors = new MutationObserver(() => setTheme(x => x + 1)); colors.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { observer.disconnect(); resize.disconnect(); colors.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  return { ref, visible, width, theme };
}
