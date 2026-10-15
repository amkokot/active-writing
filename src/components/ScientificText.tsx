import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { mathParts } from "../mathText";

export function ScientificText({ text }: { text: string }) {
  const parts = useMemo(() => mathParts(text).map((part) => {
    if (!part.math) return part;
    try { return { ...part, html: katex.renderToString(part.text, { displayMode: part.display, trust: false, maxExpand: 500, maxSize: 10, throwOnError: false, strict: "ignore", macros: {} }) }; }
    catch { return { text: `${part.display ? "$$" : "$"}${part.text}${part.display ? "$$" : "$"}` }; }
  }), [text]);
  return <div className="study-prose">{parts.map((part, index) => "html" in part
    ? <span key={index} className={part.display ? "study-math-display" : "study-math"} data-latex={`${part.display ? "$$" : "$"}${part.text}${part.display ? "$$" : "$"}`} dangerouslySetInnerHTML={{ __html: part.html! }} />
    : <span key={index}>{part.text}</span>)}</div>;
}
