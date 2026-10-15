import { readWindowRequest, windowWorkspaceUrl } from "./windowWorkspace.ts";
import type { AppState, ProjectDocument, ReferenceToken } from "./types.ts";
import { groupAt } from "./references.ts";
import { latexText } from "./manuscripts.ts";

export function workspaceBackLink(base: string, value?: string, projectId?: string) {
  if (!value || value.length > 2000) return undefined;
  try {
    const origin = new URL(base), url = new URL(value, origin), request = readWindowRequest(url.search);
    if (url.origin !== origin.origin || url.pathname !== origin.pathname || !request || request.panel !== "paper" || request.projectId !== projectId || url.searchParams.has("awBack")) return undefined;
    return url.href;
  } catch { return undefined; }
}
/** Live saved evidence, not an immutable snapshot. No code runs on navigation. */
export function experimentCellUrl(base: string, projectId: string, entryId: string, cellId: string, revision: string, outputIndex?: number, backLink?: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(cellId) || outputIndex !== undefined && (!Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex >= 30)) throw new Error("Choose an existing cell and saved output index.");
  const url = new URL(base); url.search = ""; url.hash = "";
  for (const [key, value] of Object.entries({ awProject: projectId, awPanel: "notebook", awNotebook: entryId, awCell: cellId, awEvidence: revision, awFormat: "reading" })) url.searchParams.set(key, value);
  if (outputIndex !== undefined) url.searchParams.set("awOutput", String(outputIndex));
  const back = workspaceBackLink(base, backLink, projectId); if (back) url.searchParams.set("awBack", back);
  return url.href;
}
export function manuscriptPassageUrl(base: string, document: ProjectDocument, state: AppState, paragraphId?: string) {
  const paragraph = document.paragraphs.find(p => p.id === paragraphId && !p.emptySource);
  return paragraph ? windowWorkspaceUrl(base, document, { ...state, activeNodeId: paragraph.nodeId, activeParagraphId: paragraph.id }, "paper", "reading") : undefined;
}
export function latexEvidenceLink(url: string, label: string) {
  return `\\href{${url.replace(/[%&#]/g, c => `\\${c}`)}}{${latexText(label)}}`;
}

/** Display label only. The token.raw and all source offsets remain unchanged. */
export function compactAwReference(token: ReferenceToken) {
  if (token.kind !== "url" || token.raw.length < 120 || token.keys.length !== 1) return undefined;
  try {
    const url = new URL(token.keys[0].replace(/\\([%&#])/g, "$1"));
    if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || !url.searchParams.get("awProject")) return undefined;
    const panel = url.searchParams.get("awPanel");
    if (panel !== "paper" && panel !== "notebook") return undefined;
    const label = panel === "paper" ? "Aw passage" : url.searchParams.has("awOutput") ? "Aw output" : "Aw notebook";
    const opening = token.raw.indexOf("{"), first = groupAt(token.raw, opening);
    if (!first) return undefined;
    // Keep authored link text (including nested LaTeX) rather than inventing a title.
    return token.raw.slice(0, opening + 1) + `[${label}]` + token.raw.slice(first.end - 1);
  } catch { return undefined; }
}
