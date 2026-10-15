import { useEffect, useMemo, useState } from "react";
import { lineAtOffset, sourceLineStarts } from "./sourceLines";
import type { ProjectDocument } from "./types";

/** Uses the existing file API, so an older running Aw service needs no restart. */
export function useSourceLines(paper?: ProjectDocument) {
  const [lines, setLines] = useState<{identity: string; values: Record<string, number>}>();
  const identity = paper ? `${paper.project.id}:${paper.project.mainFile}:${paper.revision}` : "";
  useEffect(() => {
    if (!paper) return;
    const controller = new AbortController();
    const files = [...new Set(paper.paragraphs.map(p => p.file).filter((f): f is string => !!f))];
    void Promise.all(files.map(async file => {
      const response = await fetch(`/api/paperfocus/document?projectId=${encodeURIComponent(paper.project.id)}&sourceFile=${encodeURIComponent(file)}`, { signal: controller.signal });
      if (!response.ok) return {};
      const data = await response.json();
      if (data.revision !== paper.revision || data.mainFile !== paper.project.mainFile || typeof data.source !== "string" || !Array.isArray(data.positions)) return {};
      const starts = sourceLineStarts(data.source);
      return Object.fromEntries(data.positions.map((p: {paragraphId: string; start: number}) => [p.paragraphId, lineAtOffset(starts, p.start)]));
    })).then(values => { if (!controller.signal.aborted) setLines({identity, values: Object.assign({}, ...values)}); }).catch(() => { /* unavailable source numbers are not guessed */ });
    return () => controller.abort();
  }, [identity]);
  return useMemo(() => (paper?.paragraphs ?? []).map(p => ({ ...p, sourceLine: lines?.identity === identity ? lines.values[p.id] : undefined })), [paper?.paragraphs, lines, identity]);
}
