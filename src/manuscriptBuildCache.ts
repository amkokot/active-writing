import type { CompileResult, ProjectDocument } from "./types.ts";

export function manuscriptBuildIdentity(document: ProjectDocument) {
  return JSON.stringify([document.project.id, document.project.mainFile, document.project.engine]);
}
export function manuscriptBuildScope(scope: NonNullable<CompileResult["scope"]>) {
  return JSON.stringify([scope.focusNodeId, scope.lens ?? "paper", [...(scope.hiddenNodeIds ?? [])].sort(), scope.paragraphIds]);
}
export function matchingManuscriptBuild(result: CompileResult | undefined, document: ProjectDocument) {
  return Boolean(result?.success && result.pdfUrl && result.mainFile === document.project.mainFile
    && result.engine === document.project.engine && result.sourceRevision === document.revision && !result.stale);
}

/** Metadata only. Focus PDFs have immutable artifact keys; full-PDF endpoints
 * depend on the selected root and must not be retained as immutable artifacts. */
export class ManuscriptBuildCache {
  private builds = new Map<string, CompileResult>();
  remember(document: ProjectDocument, result: CompileResult) {
    if (!matchingManuscriptBuild(result, document) || result.mode !== "focus" || result.originalPages?.length || !/^[a-f0-9]{16}$/.test(result.artifactKey ?? "")) return;
    const key = JSON.stringify([manuscriptBuildIdentity(document), manuscriptBuildScope(result.scope ?? {})]);
    this.builds.delete(key); this.builds.set(key, structuredClone(result));
    while (this.builds.size > 12) this.builds.delete(this.builds.keys().next().value!);
  }
  read(document: ProjectDocument, scope?: string) {
    const identity = manuscriptBuildIdentity(document);
    const key = scope === undefined ? [...this.builds.keys()].reverse().find(key => JSON.parse(key)[0] === identity)
      : JSON.stringify([identity, scope]);
    if (!key) return;
    const result = this.builds.get(key);
    if (!matchingManuscriptBuild(result, document)) return;
    this.builds.delete(key); this.builds.set(key, result!);
    return structuredClone(result);
  }
}
