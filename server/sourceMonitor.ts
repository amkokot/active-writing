import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { getProject, projectFiles, projectRevision } from "./projects.ts";
import { manuscriptPurpose } from "../src/manuscripts.ts";

/** Stat-only between changes; periodic content verification also catches restored timestamps. */
export function createSourceMonitor(now = Date.now) {
  const cache = new Map<string, { signature: string; revision: string; checkedAt: number }>();
  const running = new Map<string, Promise<{ projectId: string; rootFile: string; engine: string | undefined; revision: string; purpose: string; overviewTarget: string }>>();
  return async (workspace: string, projectId: string) => {
    const key = `${workspace}\0${projectId}`;
    if (running.has(key)) return running.get(key)!;
    const operation = (async () => {
      const { project, root } = await getProject(workspace, projectId);
      const files = (await projectFiles(root)).sort();
      const digest = createHash("sha256");
      digest.update(`${root}\0${project.mainFile}\0${project.engine}\0`);
      for (const file of files) {
        const info = await stat(path.join(root, file));
        digest.update(`${file}\0${info.size}\0${info.mtimeMs}\0${info.ctimeMs}\0`);
      }
      const signature = digest.digest("hex"); const previous = cache.get(key);
      const revision = previous && previous.signature === signature && now() - previous.checkedAt < 60_000
        ? previous.revision : await projectRevision(root, files);
      cache.set(key, { signature, revision, checkedAt: previous?.signature === signature && revision === previous.revision && now() - previous.checkedAt < 60_000 ? previous.checkedAt : now() });
      if (cache.size > 20) cache.delete(cache.keys().next().value!);
      return { projectId: project.id, rootFile: project.mainFile, engine: project.engine, revision, purpose: manuscriptPurpose(project), overviewTarget: project.manuscriptOverviewTargets?.[project.mainFile] ?? "" };
    })();
    running.set(key, operation);
    try { return await operation; } finally { running.delete(key); }
  };
}
