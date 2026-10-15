import { groupAt } from "./references.ts";

export interface MathPart { text: string; math?: boolean; display?: boolean; code?: boolean; start: number; end: number }

/** Presentation only: labels stay in source, and quick view never invents equation numbers. */
function readingEquation(body: string, environment?: string) {
  let result = body.replace(/(?<!\\)%[^\r\n]*/g, ""), cursor = 0, output = "";
  const labels = /\\label\s*\{/g; let match: RegExpExecArray | null;
  while ((match = labels.exec(result))) {
    const group = groupAt(result, labels.lastIndex - 1); if (!group) continue;
    output += result.slice(cursor, match.index); cursor = group.end; labels.lastIndex = cursor;
  }
  result = output + result.slice(cursor);
  if (!environment || /^(?:equation\*?|displaymath|math)$/.test(environment)) return result;
  const base = environment.replace(/\*$/, "");
  const wrapper = base === "gather" || base === "multline" ? "gather*" : /^(?:align|flalign|eqnarray|split)$/.test(base) ? "align*" : base === "alignat" ? "alignat*" : base;
  return `\\begin{${wrapper}}${result}\\end{${wrapper}}`;
}

// Bounded literal math support, never a TeX evaluator. Code and escaped dollars stay literal.
export function mathParts(text: string, maxParts = 256): MathPart[] {
  const result: MathPart[] = []; let start = 0; let at = 0;
  while (at < text.length && result.length < maxParts) {
    if (text[at] === "`" || text[at] === "~") {
      const marker = text.slice(at).match(/^(?:`+|~+)/)![0];
      const lineStart = text.lastIndexOf("\n", at - 1) + 1;
      const fenced = marker.length >= 3 && /^ {0,3}$/.test(text.slice(lineStart, at));
      if (fenced || text[at] === "`") {
        let end = -1;
        if (fenced) {
          const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[\\t ]*\\r?(?:\\n|$)`, "gm");
          const newline = text.indexOf("\n", at + marker.length);
          close.lastIndex = newline < 0 ? text.length : newline + 1;
          const match = close.exec(text);
          if (match) end = match.index + match[0].length;
        } else {
          let close = text.indexOf(marker, at + marker.length);
          while (close >= 0 && (text[close - 1] === "`" || text[close + marker.length] === "`")) close = text.indexOf(marker, close + marker.length);
          if (close >= 0) end = close + marker.length;
        }
        if (at > start) result.push({ text: text.slice(start, at), start, end: at });
        end = end < 0 ? text.length : end;
        result.push({ text: text.slice(at, end), code: true, start: at, end });
        at = end; start = at; continue;
      }
      at += marker.length; continue;
    }
    const escaped = (index: number) => { let count = 0; for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) count++; return count % 2 === 1; };
    if (text[at] === "%" && !escaped(at)) { const newline = text.indexOf("\n", at); at = newline < 0 ? text.length : newline + 1; continue; }
    const inComment = (index: number) => /(?<!\\)%/.test(text.slice(text.lastIndexOf("\n", index - 1) + 1, index));
    const environment = text[at] === "\\" && !escaped(at) && text.slice(at, at + 64).match(/^\\begin\s*\{(equation\*?|align\*?|alignat\*?|gather\*?|multline\*?|eqnarray\*?|flalign\*?|aligned|alignedat|gathered|split|displaymath|math|cases|matrix|[pbBvV]matrix|smallmatrix|array)\}/);
    if (environment) {
      const close = new RegExp(`\\\\end\\s*\\{${environment[1].replace(/\*/g, "\\*")}\\}`, "g");
      close.lastIndex = at + environment[0].length;
      let end = close.exec(text);
      while (end && (escaped(end.index) || inComment(end.index))) end = close.exec(text);
      if (end && end.index - at <= 4000) {
        if (at > start) result.push({ text: text.slice(start, at), start, end: at });
        result.push({ text: readingEquation(text.slice(at + environment[0].length, end.index), environment[1]), math: true, display: environment[1] !== "math", start: at, end: close.lastIndex });
        at = close.lastIndex; start = at; continue;
      }
      // An unfinished environment remains source, without swallowing later prose.
      at += environment[0].length; continue;
    }
    const open = text.startsWith("\\[", at) && !escaped(at) ? "\\[" : text.startsWith("\\(", at) && !escaped(at) ? "\\(" : text[at] === "$" && !escaped(at) ? (text[at + 1] === "$" ? "$$" : "$") : "";
    if (!open) { at++; continue; }
    const close = open === "\\[" ? "\\]" : open === "\\(" ? "\\)" : open;
    let end = text.indexOf(close, at + open.length);
    while (end >= 0 && (escaped(end) || inComment(end))) end = text.indexOf(close, end + close.length);
    if (end < 0 || end - at > 4000 || (open === "$" && (text.slice(at + 1, end).includes("\n") || !text.slice(at + 1, end).trim()))) { at += open.length; continue; }
    if (at > start) result.push({ text: text.slice(start, at), start, end: at });
    result.push({ text: readingEquation(text.slice(at + open.length, end)), math: true, display: open === "$$" || open === "\\[", start: at, end: end + close.length });
    at = end + close.length; start = at;
  }
  if (start < text.length) result.push({ text: text.slice(start), start, end: text.length });
  return result;
}
