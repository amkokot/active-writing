import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type { ParsedProject } from "./projects.ts";
import type { Lens } from "../src/types.ts";
import { visiblePreviewNodes } from "../src/workspaceTools.ts";

/** Partition the selected source, never rewrite or split a manuscript file. */
export function sectionPdfGroups(parsed: ParsedProject, options: { lens?: Lens; focusNodeId?: string; hiddenNodeIds?: string[]; paragraphIds?: string[] }) {
  const visible = new Set(visiblePreviewNodes(parsed.nodes, options.lens ?? "paper", options.focusNodeId, options.hiddenNodeIds).map(n => n.id));
  const selected = options.paragraphIds && new Set(options.paragraphIds), nodes = new Map(parsed.nodes.map(n => [n.id, n]));
  const groups = new Map<string, { nodeId: string; title: string; paragraphIds: string[] }>();
  for (const paragraph of parsed.paragraphs) {
    if (!visible.has(paragraph.nodeId) || paragraph.emptySource || selected && !selected.has(paragraph.id)) continue;
    let section = nodes.get(paragraph.nodeId); const seen = new Set<string>();
    for (let node = section; node && !seen.has(node.id); node = nodes.get(node.parentId ?? "")) {
      seen.add(node.id); if (!node.environment) section = node;
    }
    const id = section?.id ?? paragraph.nodeId;
    if (!groups.has(id)) groups.set(id, { nodeId: id, title: section?.id === "document" ? "Front matter" : section?.title ?? "Text", paragraphIds: [] });
    groups.get(id)!.paragraphIds.push(paragraph.id);
  }
  if (!groups.size) throw new Error("No visible text is available for a Section PDF.");
  if (groups.size > 128) throw new Error("This view has more than 128 sections. Choose a smaller view or Continuous PDF.");
  return [...groups.values()];
}

export async function sectionPageCount(file: string) {
  const text = gunzipSync(await readFile(file), { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8");
  let pages = 0;
  for (const match of text.matchAll(/^\{(\d+)\r?$/gm)) pages = Math.max(pages, Number(match[1]));
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 100000) throw new Error("The section PDF has no usable page map.");
  return pages;
}
