import { useLayoutEffect, useState, type RefObject } from "react";
import { editableRangeAt } from "../editableText";
import { sourceLineStarts } from "../sourceLines";
import { textareaLineTops } from "../textareaViewport";

/** Outside contenteditable: numbers never become manuscript text or clipboard content. */
export function SourceLineNumbers({ target, text, start }: { target: RefObject<HTMLParagraphElement | HTMLTextAreaElement | null>; text: string; start?: number }) {
  const [rows, setRows] = useState<Array<{number: number; top: number}>>([]);
  const [scroll, setScroll] = useState(0);
  useLayoutEffect(() => {
    const root = target.current;
    if (!root || start === undefined) { setRows([]); return; }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        const bounds = root.getBoundingClientRect(), scale = root.offsetWidth ? bounds.width / root.offsetWidth : 1;
        if (root instanceof HTMLTextAreaElement) {
          setRows(textareaLineTops(root).map((top, index) => ({ number: start + index, top }))); return;
        }
        setRows(sourceLineStarts(text).map((offset, index) => {
          const range = editableRangeAt(root, Math.min(offset, Math.max(0, text.length - 1)));
          const rect = range.getClientRects()[0];
          return {number: start + index, top: root.offsetTop + (rect ? (rect.top - bounds.top) / (scale || 1) : index * (parseFloat(getComputedStyle(root).lineHeight) || 24))};
        }));
      });
    };
    const observer = new ResizeObserver(measure), mutations = new MutationObserver(measure);
    const scrolled = () => setScroll(root instanceof HTMLTextAreaElement ? root.scrollTop : 0);
    root.addEventListener("scroll", scrolled); scrolled();
    observer.observe(root); mutations.observe(root, {childList: true, characterData: true, subtree: true, attributes: true}); measure();
    return () => { observer.disconnect(); mutations.disconnect(); root.removeEventListener("scroll", scrolled); cancelAnimationFrame(frame); };
  }, [target, text, start]);
  return <div className="source-line-numbers" aria-hidden="true">{rows.map(row => <span key={row.number} style={{top: row.top - scroll}}>{row.number}</span>)}</div>;
}
