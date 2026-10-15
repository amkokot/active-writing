import { mathParts } from "./mathText.ts";
import { groupAt, referenceTokens, safeLink } from "./references.ts";
import type { ReferenceToken } from "./types.ts";
import { compactAwReference } from "./researchLinks.ts";

/** A bounded prose adapter, never a TeX evaluator or source rewrite. */
export function latexReading(text: string, depth = 0): string {
  if (depth > 8) return text;
  const protectedParts = mathParts(text, Infinity).filter(part => part.math || part.code);
  const commands = /\\(href|url|textbf|textit|emph|texttt|textrm|textnormal|textsf|underline)\b\s*/g;
  let match: RegExpExecArray | null, cursor = 0, protectedIndex = 0, result = "";
  while ((match = commands.exec(text))) {
    while (protectedParts[protectedIndex]?.end <= match.index) protectedIndex++;
    if (protectedParts[protectedIndex] && match.index >= protectedParts[protectedIndex].start && match.index < protectedParts[protectedIndex].end) continue;
    const first = groupAt(text, commands.lastIndex); if (!first) continue;
    const command = match[1]; let end = first.end, replacement: string;
    if (command === "href" || command === "url") {
      let label = first.text;
      if (command === "href") {
        const next = first.end + (text.slice(first.end).match(/^\s*/)?.[0].length ?? 0);
        const second = groupAt(text, next); if (!second) continue;
        label = latexReading(second.text, depth + 1); end = second.end;
      }
      const raw = text.slice(match.index, end), url = safeLink(first.text.replace(/\\([%&#_])/g, "$1"));
      if (command === "url") {
        const compact = compactAwReference({ kind: "url", keys: [first.text], raw, start: 0, end: raw.length });
        if (compact) label = compact.match(/\[([^\]]+)\]/)?.[1] ?? "Aw link";
        else label = first.text.replace(/\\([%&#_])/g, "$1").replace(/[\[\]]/g, "\\$&");
      }
      // Angle destinations prevent parentheses in a URL breaking Markdown.
      replacement = url ? `[${label.replace(/(?<!\\)([\[\]])/g, "\\$1")}](${"<" + url.replace(/[<>\r\n]/g, c => encodeURIComponent(c))}>)` : label;
    } else {
      const body = latexReading(first.text, depth + 1);
      if (command === "texttt") {
        const ticks = "`".repeat(Math.max(0, ...[...first.text.matchAll(/`+/g)].map(m => m[0].length)) + 1);
        replacement = `${ticks} ${first.text} ${ticks}`;
      } else replacement = command === "textbf" ? `**${body}**` : command === "textit" || command === "emph" ? `*${body}*` : body;
    }
    result += text.slice(cursor, match.index) + replacement;
    cursor = end; commands.lastIndex = end;
  }
  return result + text.slice(cursor);
}

/** References use the app's resolver, never an invented PDF/label destination. */
export function readingReferences(text: string) {
  const protectedParts = mathParts(text, Infinity).filter(part => part.math || part.code);
  const references = new Map<string, ReferenceToken>();
  let cursor = 0, result = "", protectedIndex = 0;
  for (const token of referenceTokens(text)) {
    while (protectedParts[protectedIndex]?.end <= token.start) protectedIndex++;
    if (token.kind === "url" || protectedParts[protectedIndex] && token.start >= protectedParts[protectedIndex].start && token.start < protectedParts[protectedIndex].end) continue;
    const key = `#aw-reading-reference-${references.size}`;
    references.set(key, token);
    let label = token.kind === "citation" ? `[${token.keys.join(", ")}]` : token.keys.join(", ");
    if (/^\\eqref/.test(token.raw)) label = `(${label})`;
    if (/^\\hyperref/.test(token.raw)) label = groupAt(token.raw, token.raw.indexOf("{"))?.text ?? label;
    result += text.slice(cursor, token.start) + `[${label.replace(/([\[\]])/g, "\\$1")}](${key})`;
    cursor = token.end;
  }
  return { text: result + text.slice(cursor), references };
}
