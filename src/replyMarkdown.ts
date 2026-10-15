import { createElement, memo, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import katex from "katex";
import { mathParts } from "./mathText.ts";
import { safeLink } from "./references.ts";
import { latexReading, readingReferences } from "./latexReading.ts";
import type { ReferenceToken } from "./types.ts";
import { latexStructure, type ReadingStructureOptions } from "./latexStructure.ts";
import { readingFigures, type ReadingFigure, type ReadingFigureContext } from "./readingFigures.ts";

function ProjectFigure({ figure }: { figure: ReadingFigure }) {
  const [failed, setFailed] = useState(false);
  if (!figure.url || failed) return createElement("span", { className: "reading-figure-unavailable", role: "status" },
    `Figure unavailable: ${figure.path}. Check the project path in Files, or use the compiled LaTeX PDF for unsupported graphics.`);
  if (!figure.image) return createElement("a", { href: figure.url, target: "_blank", rel: "noopener noreferrer" }, `Open PDF figure: ${figure.path}`);
  return createElement("span", { className: "reading-project-figure" }, createElement("img", {
    src: figure.url, alt: `Project figure: ${figure.path}`, loading: "lazy", style: { width: figure.width }, onError: () => setFailed(true),
  }));
}

/** Display adaptation only. Clipboard text and its original delimiters stay saved verbatim. */
export function markdownMath(text: string) {
  // Full reading is explicit. The small-snippet budget must not leave later
  // TeX equations unrendered or adapt delimiters inside a later code fence.
  return mathParts(text, Infinity).map((part) => {
    if (!part.math) return text.slice(part.start, part.end);
    return part.display ? `\n\n$$\n${part.text}\n$$\n\n` : `$${part.text}$`;
  }).join("");
}

export function replyLink(url: string) {
  // No filesystem/javascript/data URLs or remotely loaded images in imported replies.
  return url.startsWith("#") ? url : safeLink(url) ?? "";
}

const components: Components = {
  a: ({ node: _node, href, children, ...props }) => href ? createElement("a", { ...props, href, target: href.startsWith("#") ? undefined : "_blank", rel: "noopener noreferrer" }, children) : createElement("span", null, children),
  img: ({ alt }) => createElement("span", { className: "reply-image-placeholder" }, `[Image not loaded${alt ? `: ${alt}` : ""}]`),
  table: ({ node: _node, ...props }) => createElement("div", { className: "reply-table-scroll" }, createElement("table", props)),
  pre: ({ node, children, ...props }) => {
    const child = node?.children[0];
    const classes = child?.type === "element" ? child.properties.className : [];
    return createElement(Array.isArray(classes) && classes.includes("language-math") ? "div" : "pre", props, children);
  },
  code: ({ node: _node, className, children, ...props }) => {
    if (!className?.split(" ").includes("language-math")) return createElement("code", { ...props, className }, children);
    const latex = String(children).replace(/\n$/, "");
    const display = className.split(" ").includes("math-display");
    if (latex.length > 4000) return createElement("code", null, latex);
    try {
      const html = katex.renderToString(latex, { displayMode: display, trust: false, maxExpand: 500, maxSize: 10, throwOnError: true, strict: "ignore", macros: {} });
      return createElement("span", { className: display ? "study-math-display" : "study-math", "data-latex": `${display ? "$$" : "$"}${latex}${display ? "$$" : "$"}`, dangerouslySetInnerHTML: { __html: html } });
    } catch { return createElement("code", { className: "reading-math-source", title: "This equation needs full LaTeX compilation. Other text remains rendered." }, latex); }
  },
};

/** CommonMark/GFM reader; raw HTML is escaped, never activated. No model or network call. */
export interface ReplyMarkdownProps extends ReadingStructureOptions { text: string; onReference?: (token: ReferenceToken) => void; onHeading?: (id: string) => void; figureContext?: ReadingFigureContext }
export const ReplyMarkdown = memo(function ReplyMarkdown({ text, onReference, contents, onHeading, figureContext }: ReplyMarkdownProps) {
  const adapted = onReference ? readingReferences(text) : undefined;
  const figureReading = readingFigures(adapted?.text ?? text, figureContext);
  const scopedComponents: Components = { ...components,
    img: ({ src, alt }) => {
      const figure = src && figureReading.figures.get(src);
      return figure ? createElement(ProjectFigure, { key: figure.url ?? figure.path, figure }) : createElement("span", { className: "reply-image-placeholder" }, `[Image not loaded${alt ? `: ${alt}` : ""}]`);
    }, a: ({ node: _node, href, children, ...props }) => {
    const token = href && adapted?.references.get(href);
    const heading = href?.startsWith("#aw-reading-heading-") && contents?.find(item => href === `#aw-reading-heading-${encodeURIComponent(item.id)}`);
    if (token || heading && onHeading) return createElement("a", { ...props, href, onClick: event => { event.preventDefault(); if (token) onReference!(token); else if (heading) onHeading!(heading.id); } }, children);
    return href ? createElement("a", { ...props, href, target: href.startsWith("#") ? undefined : "_blank", rel: "noopener noreferrer" }, children) : createElement("span", null, children);
  } };
  return createElement("div", { className: "reply-markdown" }, createElement(Markdown, {
    remarkPlugins: [remarkGfm, remarkMath], components: scopedComponents, urlTransform: replyLink,
    children: markdownMath(latexStructure(latexReading(figureReading.text), { contents })),
  }));
});
