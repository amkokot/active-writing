import type { SourceReturnAnchor } from "./types.ts";
import type { WindowRequest } from "./windowWorkspace.ts";
import { parseManuscriptView, type ManuscriptView } from "./manuscripts.ts";

export const lastProjectKey = "active-writing.last-project.v1";
export const sessionProjectKey = "active-writing.window.project";
type Store = Pick<Storage, "getItem" | "setItem">;
export interface WorkspaceResume {
  version: 1;
  rootFile: string;
  previewFormat: "pdf" | "reading";
  rawEditor: boolean;
  sourceFile?: string;
  sourcePosition?: SourceReturnAnchor & { nodeId: string; viewportOffset: number };
  manuscriptView?: ManuscriptView;
}
export const resumeKey = (projectId: string, rootFile?: string) => `active-writing.resume.v1.${projectId}${rootFile === undefined ? "" : `.root.${encodeURIComponent(rootFile)}`}`;
const projectId = (value: string | null | undefined) => value && /^[\w-]{1,200}$/.test(value) ? value : undefined;
export function startupProject(session: Store, local: Store, request?: WindowRequest) {
  // A restored tab resumes its own last project. A newly requested companion
  // must not be redirected by another window's last-used project preference.
  let own: string | undefined; try { own = projectId(session.getItem(sessionProjectKey)); } catch { /* optional */ }
  if (own || request) return own ?? request?.projectId;
  try { return projectId(local.getItem(lastProjectKey)); } catch { return undefined; }
}
export function rememberProject(session: Store, local: Store, id: string, active = true) {
  if (!projectId(id)) return;
  try { session.setItem(sessionProjectKey, id); } catch { /* optional */ }
  if (active) try { local.setItem(lastProjectKey, id); } catch { /* optional */ }
}
export function parseWorkspaceResume(raw: string | undefined | null): WorkspaceResume | undefined {
  try {
    const r = JSON.parse(raw ?? "null") as WorkspaceResume;
    if (!r || r.version !== 1 || typeof r.rootFile !== "string" || r.rootFile.length > 2000 || !["pdf", "reading"].includes(r.previewFormat) || typeof r.rawEditor !== "boolean") return;
    const p = r.sourcePosition;
    const position = p && typeof p.paragraphId === "string" && typeof p.nodeId === "string" && typeof p.paragraphText === "string" && p.paragraphText.length <= 100_000
      && typeof p.revision === "string" && (p.file === undefined || typeof p.file === "string") && Number.isFinite(p.viewportOffset) && Math.abs(p.viewportOffset) < 1_000_000 ? p : undefined;
    return { version: 1, rootFile: r.rootFile, previewFormat: r.previewFormat, rawEditor: r.rawEditor,
      sourceFile: typeof r.sourceFile === "string" && r.sourceFile.length <= 2000 ? r.sourceFile : undefined, sourcePosition: position,
      ...(parseManuscriptView(r.manuscriptView) ? { manuscriptView: parseManuscriptView(r.manuscriptView) } : {}) };
  } catch { return undefined; }
}
