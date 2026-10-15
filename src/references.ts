import type { ReferenceToken } from "./types";

export function safeLink(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value.replace(/\\&/g, "&"));
    return ["https:", "http:", "mailto:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

// Offsets always refer to the unmodified LaTeX text, including nested link text.
export function groupAt(source: string, start: number, open = "{", close = "}") {
  if (source[start] !== open) return undefined;
  let depth = 1;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === open) depth++;
    if (source[i] === close && --depth === 0) return { text: source.slice(start + 1, i), end: i + 1 };
  }
  return undefined;
}

/** Display-only folding. Never substitute this summary for token.raw when saving/copying. */
export function sourceReferenceSummary(token: ReferenceToken) {
  const raw = token.raw;
  const opening = /^\\hyperref\b/.test(raw) ? raw.indexOf("[") : raw.indexOf("{");
  if (opening < 0) return undefined;
  const group = groupAt(raw, opening, raw[opening], raw[opening] === "[" ? "]" : "}");
  if (!group || group.text.length < 96) return undefined;
  return raw.slice(0, opening + 1) + "…" + raw.slice(group.end - 1);
}

/** Only DOM presentation changes; the exact source remains a child text node. */
export function expandSourceReference(element: HTMLElement, editable: boolean) {
  if (!element.dataset.compactLabel) return;
  element.dataset.referenceExpanded = "true";
  element.setAttribute("aria-expanded", "true");
  element.contentEditable = editable ? "inherit" : "false";
}

export function referenceTokens(source: string): ReferenceToken[] {
  const masked = source.replace(/(?<!\\)%[^\r\n]*/g, (text) => " ".repeat(text.length));
  const pattern = /\\(eqref|autoref|pageref|nameref|[cC]ref|[cC]refrange|ref|hyperref|cite[a-zA-Z]*|(?:paren|text|auto|foot|smart|super)cite[a-zA-Z]*|href|url)\*?(?![a-zA-Z])/g;
  const result: ReferenceToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked))) {
    const command = match[1];
    let cursor = pattern.lastIndex;
    const skip = () => { while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++; };
    skip();
    const options: string[] = [];
    while (source[cursor] === "[" && options.length < 2) {
      const option = groupAt(source, cursor, "[", "]");
      if (!option) break;
      options.push(option.text); cursor = option.end; skip();
    }
    const argument = groupAt(source, cursor);
    if (!argument && command !== "hyperref") continue;
    let keys = command === "hyperref" ? [options[0] ?? ""] : argument!.text.split(",").map((key) => key.trim());
    let end = argument?.end ?? cursor;
    if (command === "href" || command.endsWith("range")) {
      cursor = end; skip();
      const second = groupAt(source, cursor);
      if (second) { end = second.end; if (command.endsWith("range")) keys.push(second.text.trim()); }
    }
    if (command === "href" || command === "url") keys = [argument!.text];
    const kind = command.includes("cite") ? "citation" : command === "href" || command === "url" ? "url" : "label";
    let locator = kind === "citation" ? options.at(-1)?.replace(/~/g, " ").replace(/\\(?:[a-zA-Z]+)\s*/g, " ").trim() : undefined;
    const resultName = locator?.match(/\b(theorem|thm\.?|lemma|lem\.?|proposition|prop\.?|corollary|cor\.?|definition|def\.?|section|sec\.?)\s*(\d+(?:\.\d+)*[a-z]?)/i);
    if (resultName) {
      const names: Record<string, string> = { thm: "Theorem", lem: "Lemma", prop: "Proposition", cor: "Corollary", def: "Definition", sec: "Section" };
      const name = resultName[1].replace(/\.$/, "").toLowerCase();
      locator = `${names[name] ?? name[0].toUpperCase() + name.slice(1)} ${resultName[2]}`;
    }
    result.push({ kind, keys: keys.filter(Boolean), start: match.index, end, raw: source.slice(match.index, end), locator });
    pattern.lastIndex = end;
  }
  return result;
}
