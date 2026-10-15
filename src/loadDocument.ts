import type { ProjectDocument } from "./types";

const requests = new Map<string, Promise<ProjectDocument>>();
/** Share concurrent startup reads (including development StrictMode), not stale documents. */
export function loadDocument(url: string): Promise<ProjectDocument> {
  const pending = requests.get(url);
  if (pending) return pending;
  const request = fetch(url).then(async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Couldn't open the paper.");
    return result as ProjectDocument;
  }).finally(() => { if (requests.get(url) === request) requests.delete(url); });
  requests.set(url, request);
  return request;
}
