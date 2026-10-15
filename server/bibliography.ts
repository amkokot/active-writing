import type { CitationEntry } from "../src/types.ts";
import { groupAt, safeLink } from "../src/references.ts";

export function arxivId(value: string) {
  const candidate = value.trim().replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "").replace(/\.pdf$/i, "").replace(/^arxiv:\s*/i, "");
  return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(candidate) ? candidate : undefined;
}

export function parseBibliography(source: string, file: string): CitationEntry[] {
  const entries: CitationEntry[] = [];
  const pattern = /@(?!comment\b|string\b|preamble\b)[\w-]+\s*\{/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const body = groupAt(source, pattern.lastIndex - 1);
    if (!body) continue;
    pattern.lastIndex = body.end;
    const separator = body.text.indexOf(",");
    if (separator < 0) continue;
    const key = body.text.slice(0, separator).trim();
    const fields: Record<string, string> = {};
    const fieldPattern = /([\w-]+)\s*=\s*/g;
    fieldPattern.lastIndex = separator + 1;
    let field: RegExpExecArray | null;
    while ((field = fieldPattern.exec(body.text))) {
      const start = fieldPattern.lastIndex;
      let end = start;
      let value = "";
      if (body.text[start] === "{") {
        const group = groupAt(body.text, start);
        if (!group) break;
        value = group.text; end = group.end;
      } else if (body.text[start] === '"') {
        end++;
        while (end < body.text.length && (body.text[end] !== '"' || body.text[end - 1] === "\\")) end++;
        value = body.text.slice(start + 1, end); end++;
      } else {
        while (end < body.text.length && !/[\r\n,]/.test(body.text[end])) end++;
        value = body.text.slice(start, end).trim();
      }
      fields[field[1].toLowerCase()] = value;
      fieldPattern.lastIndex = end;
    }
    const fromJournal = fields.journal?.match(/arxiv:\s*((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)/i)?.[1];
    entries.push({ key, title: fields.title?.replace(/[{}]/g, ""), author: fields.author, year: fields.year,
      url: safeLink(fields.url), doi: fields.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
      arxivId: arxivId(fields.eprint ?? "") ?? arxivId(fields.url ?? "") ?? arxivId(fromJournal ?? ""),
      file: fields.file, bibliographyFile: file });
  }
  return entries;
}

// Inline bibliographies have no BibTeX file. Keep explicit keys and links; only
// extract a title when a \newblock delimiter identifies it, rather than guessing.
export function parseInlineBibliography(source: string, file: string): CitationEntry[] {
  const masked = source.replace(/(?<!\\)%[^\r\n]*/g, (text) => " ".repeat(text.length));
  const entries: CitationEntry[] = [];
  for (const environment of masked.matchAll(/\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/g)) {
    const body = source.slice(environment.index, environment.index! + environment[0].length);
    const items = [...environment[0].matchAll(/\\bibitem(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g)];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const text = body.slice(item.index! + item[0].length, items[i + 1]?.index ?? body.lastIndexOf("\\end{thebibliography}"));
      const active = text.replace(/(?<!\\)%[^\r\n]*/g, "");
      const blocks = active.split(/\\newblock\b/);
      const url = [...active.matchAll(/\\(?:url|href)\s*\{([^}]+)\}/g)].map((m) => safeLink(m[1])).find(Boolean);
      const explicitArxiv = active.match(/arxiv:\s*((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)/i)?.[1];
      entries.push({ key: item[1], bibliographyFile: file,
        title: blocks.length > 1 ? blocks[1].replace(/\\(?:emph|textit|textbf)\b/g, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim() : undefined,
        url, arxivId: arxivId(url ?? "") ?? arxivId(explicitArxiv ?? "") });
    }
  }
  return entries;
}
