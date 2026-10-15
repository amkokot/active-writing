import type { ManuscriptPurpose } from "./types.ts";
export interface WorkspaceFolders {
  home: { path: string; link: string };
  code?: { path: string; link: string };
  paper?: { id: string; name: string; path: string; link: string; mainFile?: string; manuscriptPurposes?: Record<string, ManuscriptPurpose>; manuscriptOverviewTargets?: Record<string, string> };
  data?: { path: string; link: string };
  guidePath: string;
  canOpen: boolean;
}

export function workspaceNote(folders: WorkspaceFolders) {
  return [folders.paper ? `Paper working folder: ${folders.paper.path}` : `Working folder: ${folders.home.path}`,
    `Active Writing home: ${folders.home.path}`, `Research guide: ${folders.guidePath}`,
    ...(folders.code ? [`Aw code and tools: ${folders.code.path} (use this code path with the explicit data home in --workspace)`] : []),
    ...(folders.data ? [`This paper's Aw files: ${folders.data.path} (outside the manuscript repository)`] : []),
    "Use our conversation for unchanged context. Read the guide sections needed for this task.",
    "Follow the current request's permissions; do not change the manuscript unless asked."].join("\n");
}
