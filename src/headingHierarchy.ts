import type { ManuscriptNode } from "./types.ts";

/** Article-style LaTeX headings; depths stay compatible with saved outlines. */
export const sectionCommands = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"] as const;

export function sectionHeadingLevel(node: ManuscriptNode): number | undefined {
  if (node.environment || (node.kind !== "section" && node.kind !== "subsection")) return undefined;
  return Math.max(0, Math.min(sectionCommands.length - 1, node.depth));
}

export function manuscriptHeadingTag(node: ManuscriptNode): "h1" | "h2" | "h3" | "h4" | "h5" {
  const level = sectionHeadingLevel(node);
  // Results and proofs have their own visual treatment, not a section depth.
  return level === undefined ? "h3" : (["h1", "h2", "h3", "h4", "h5"] as const)[level];
}
