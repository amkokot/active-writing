import { mathParts } from "./mathText.ts";
import { groupAt } from "./references.ts";
import { sourceOrderedBlocks } from "./workspaceTools.ts";
import { sectionHeadingLevel } from "./headingHierarchy.ts";
import type { ManuscriptNode, Paragraph } from "./types.ts";

export interface ReadingHeading { id: string; title: string; level: number; nodeId?: string; paragraphId?: string }
export interface ReadingStructureOptions { contents?: ReadingHeading[] }
const headingNames = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"];
interface Directive { start: number; end: number; name: string; argument?: string; starred?: boolean }

/** Literal, balanced commands only. Unknown/incomplete syntax stays editable source. */
function directives(text: string): Directive[] {
  const protectedParts = mathParts(text, Infinity).filter(part => part.math || part.code);
  const pattern = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|tableofcontents|newpage|clearpage|cleardoublepage|pagebreak|label|begin|end|item)\b(\*)?\s*/g;
  const result: Directive[] = []; let match: RegExpExecArray | null, protectedIndex = 0;
  while ((match = pattern.exec(text))) {
    while (protectedParts[protectedIndex]?.end <= match.index) protectedIndex++;
    if (protectedParts[protectedIndex] && match.index >= protectedParts[protectedIndex].start && match.index < protectedParts[protectedIndex].end) continue;
    // Do not activate commands in comments or escaped backslashes.
    const line = text.slice(text.lastIndexOf("\n", match.index - 1) + 1, match.index);
    if (/(?<!\\)%/.test(line)) continue;
    let slashes = 0; for (let at = match.index - 1; at >= 0 && text[at] === "\\"; at--) slashes++;
    if (slashes % 2) continue;
    const name = match[1]; let end = pattern.lastIndex, argument: string | undefined;
    if (text[end] === "[") {
      const option = groupAt(text, end, "[", "]"); if (!option) continue;
      argument = option.text; end = option.end;
      end += text.slice(end).match(/^\s*/)?.[0].length ?? 0;
    }
    if (headingNames.includes(name) || ["label", "begin", "end"].includes(name)) {
      const group = groupAt(text, end); if (!group) continue;
      argument = group.text; end = group.end;
    }
    result.push({ start: match.index, end, name, argument, starred: Boolean(match[2]) });
    pattern.lastIndex = end;
  }
  return result;
}

export function latexHeadings(text: string): Array<ReadingHeading & { start: number; starred: boolean }> {
  return directives(text).filter(item => headingNames.includes(item.name)).map(item => ({
    id: `local-${item.start}`, title: item.argument!, level: headingNames.indexOf(item.name), start: item.start, starred: Boolean(item.starred),
  }));
}

const linkLabel = (text: string) => text.replace(/\r?\n/g, " ").replace(/([\\`*[\]<>])/g, "\\$1");

/** Includes literal part/chapter headings without changing parsed IDs or source ownership. */
export function manuscriptContents(nodes: ManuscriptNode[], paragraphs: Paragraph[], edits: Record<string, string>): ReadingHeading[] {
  const result: ReadingHeading[] = [], byId = new Map(paragraphs.map(p => [p.id, p]));
  for (const node of sourceOrderedBlocks(nodes, paragraphs)) {
    const level = sectionHeadingLevel(node);
    if (!node.continued && node.id !== "document" && level !== undefined && !/^\\\w+\*/.test(node.sourceOpening?.text ?? "")) result.push({ id: node.id, title: node.title, level: level + 2, nodeId: node.id, paragraphId: node.paragraphIds[0] });
    for (const id of node.paragraphIds) {
      const paragraph = byId.get(id); if (!paragraph) continue;
      for (const heading of latexHeadings(edits[id] ?? paragraph.text)) if (!heading.starred) result.push({ ...heading, id: `${id}:${heading.start}`, paragraphId: id, nodeId: node.id });
    }
  }
  return result;
}

/** Approximate reading layout: no pagination, macro execution, counters or source writes. */
export function latexStructure(text: string, options: ReadingStructureOptions = {}): string {
  const headings = options.contents ?? latexHeadings(text).filter(item => !item.starred);
  const minimumLevel = headings.length ? Math.min(...headings.map(h => h.level)) : 0;
  const contents = headings.length ? headings.map(heading => {
    const label = linkLabel(heading.title);
    const entry = options.contents ? `[${label}](#aw-reading-heading-${encodeURIComponent(heading.id)})` : label;
    return `${"  ".repeat(Math.min(4, Math.max(0, heading.level - minimumLevel)))}- ${entry}`;
  }).join("\n") : "No headings in this reading view.";
  const lists: string[] = []; let cursor = 0, result = "";
  for (const item of directives(text)) {
    let replacement: string | undefined;
    if (headingNames.includes(item.name)) replacement = `\n\n${"#".repeat(Math.min(6, headingNames.indexOf(item.name) + 1))} ${item.argument}\n\n`;
    else if (item.name === "tableofcontents") replacement = `\n\n### Contents\n\n${contents}\n\n`;
    else if (["newpage", "clearpage", "cleardoublepage", "pagebreak"].includes(item.name)) replacement = "\n\n---\n\n";
    else if (item.name === "label") replacement = "";
    else if (["begin", "end"].includes(item.name) && ["itemize", "enumerate", "description", "quote", "quotation", "center", "flushleft", "flushright"].includes(item.argument ?? "")) {
      if (["itemize", "enumerate", "description"].includes(item.argument!)) {
        if (item.name === "begin") lists.push(item.argument!);
        else if (lists.at(-1) === item.argument) lists.pop();
      }
      replacement = "\n\n";
    } else if (item.name === "item" && lists.length) replacement = `\n${"  ".repeat(lists.length - 1)}${lists.at(-1) === "enumerate" ? "1." : "-"} ${item.argument ? `**${item.argument}** ` : ""}`;
    if (replacement !== undefined) { result += text.slice(cursor, item.start) + replacement; cursor = item.end; }
  }
  return result + text.slice(cursor);
}
