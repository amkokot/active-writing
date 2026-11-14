import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { SectionPdfPart } from "./types.ts";
import type { ReadingPosition } from "./readingPosition.ts";

export function sectionReadingPosition(parts: SectionPdfPart[], position: ReadingPosition) {
  const part = parts.find(p => p.nodeId === position.sectionId);
  return part && position.sectionPage ? { ...position, page: part.pageOffset + Math.min(part.pageCount, Math.max(1, position.sectionPage)) } : position;
}

export function sectionPageOwner(parts: SectionPdfPart[], page: number) {
  return parts.findIndex(part => page > part.pageOffset && page <= part.pageOffset + part.pageCount);
}

/** A virtual document over existing PDF.js documents, with real page geometry
 * and links translated into the viewer's combined page order. No PDF rewriting. */
export function sectionPdfDocument(parts: SectionPdfPart[], documents: PDFDocumentProxy[]): PDFDocumentProxy {
  if (!parts.length || parts.length !== documents.length) throw new Error("No section PDFs are loaded.");
  let total = 0;
  parts.forEach((part, index) => {
    if (part.pageOffset !== total || part.pageCount !== documents[index].numPages) throw new Error("Section page counts changed. Compile this view again.");
    total += part.pageCount;
  });
  const mappedDestination = async (owner: number, dest: unknown[]) => {
    const ref = dest[0];
    const local = typeof ref === "number" ? ref : await documents[owner].getPageIndex(ref as { num: number; gen: number });
    return [local + parts[owner].pageOffset, ...dest.slice(1)];
  };
  const prefix = (owner: number, name: string) => `aw-section:${owner}:${encodeURIComponent(name)}`;
  const pages = new Map<number, Promise<PDFPageProxy>>();
  const destinations = new Map<string, Promise<unknown[] | null>>();
  return {
    numPages: total,
    getPage(page: number) {
      if (!Number.isInteger(page) || sectionPageOwner(parts, page) < 0) return Promise.reject(new Error("Invalid section PDF page."));
      if (!pages.has(page)) pages.set(page, (async () => {
        const owner = sectionPageOwner(parts, page), original = await documents[owner].getPage(page - parts[owner].pageOffset);
        return new Proxy(original, { get(target, property) {
          if (property === "getAnnotations") return async (...args: Parameters<PDFPageProxy["getAnnotations"]>) => {
            const annotations = await target.getAnnotations(...args);
            return Promise.all(annotations.map(async item => !item.dest ? item : { ...item,
              dest: typeof item.dest === "string" ? prefix(owner, item.dest) : Array.isArray(item.dest) ? await mappedDestination(owner, item.dest) : item.dest }));
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      })());
      return pages.get(page)!;
    },
    getDestination(name: string) {
      if (!destinations.has(name)) destinations.set(name, (async () => {
        const match = name.match(/^aw-section:(\d+):(.*)$/), preferred = match ? Number(match[1]) : -1;
        const raw = match ? decodeURIComponent(match[2]) : name;
        const order = [...new Set([preferred, ...parts.map((_, index) => index)])].filter(index => index >= 0 && index < parts.length);
        for (const owner of order) {
          // pdfTeX's synthetic page-one fallback is not a valid destination.
          if (parts[owner].unavailablePdfDestinations?.includes(raw)) continue;
          const target = await documents[owner].getDestination(raw);
          if (target) return mappedDestination(owner, target);
        }
        return null;
      })());
      return destinations.get(name)!;
    },
    getPageIndex() { return Promise.reject(new Error("This section link has no page owner.")); },
  } as unknown as PDFDocumentProxy;
}

type PdfTask = { promise: Promise<PDFDocumentProxy>; destroy(): Promise<void> };
export class SectionPdfPool {
  private tasks = new Map<string, PdfTask>();
  private closed = false;
  private epoch = 0;
  private loadPdf: (url: string) => PdfTask;
  constructor(loadPdf: (url: string) => PdfTask) { this.loadPdf = loadPdf; }
  async load(parts: SectionPdfPart[]) {
    const epoch = ++this.epoch;
    const documents: PDFDocumentProxy[] = [];
    for (let at = 0; at < parts.length; at += 4) {
      if (this.closed || epoch !== this.epoch) throw new Error("Section reader changed.");
      const batch = await Promise.all(parts.slice(at, at + 4).map(part => {
        if (!this.tasks.has(part.pdfUrl)) {
          const task = this.loadPdf(part.pdfUrl); this.tasks.set(part.pdfUrl, task);
          void task.promise.catch(() => { if (this.tasks.get(part.pdfUrl) === task) this.tasks.delete(part.pdfUrl); void task.destroy().catch(() => {}); });
        }
        return this.tasks.get(part.pdfUrl)!.promise;
      })); documents.push(...batch);
    }
    if (this.closed || epoch !== this.epoch) throw new Error("Section reader changed.");
    const active = new Set(parts.map(part => part.pdfUrl));
    for (const [url, task] of this.tasks) if (!active.has(url)) { this.tasks.delete(url); void task.destroy(); }
    return sectionPdfDocument(parts, documents);
  }
  async destroy() { this.closed = true; const tasks = [...this.tasks.values()]; this.tasks.clear(); await Promise.allSettled(tasks.map(task => task.destroy())); }
}

export function sectionPdfUrl(value: string, manifest: string, origin: string) {
  const url = new URL(value, origin), parent = new URL(manifest, origin);
  if (url.origin !== origin || parent.origin !== origin || url.username || url.password || url.pathname !== "/api/paperfocus/pdf/focus"
    || !url.searchParams.get("projectId") || url.searchParams.get("projectId") !== parent.searchParams.get("projectId") || !/^[a-f0-9]{16}$/.test(url.searchParams.get("build") ?? "")) throw new Error("Invalid section PDF link.");
  return url.href;
}
