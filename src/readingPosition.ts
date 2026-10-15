export interface ReadingPosition { top: number; left: number; revision: string; page?: number; scale?: number }
/** A new PDF build may retain a position only within the same manuscript/view. */
export function compiledPdfResume(previous: { identity: string; position: ReadingPosition } | undefined, identity: string | undefined, revision: string) {
  return identity && previous?.identity === identity ? { ...previous.position, revision } : undefined;
}
export const readingPositionKey = (id: string) => `active-writing.reading.v1.${encodeURIComponent(id)}`;
export function parseReadingPosition(raw?: string | null): ReadingPosition | undefined {
  try {
    const p = JSON.parse(raw ?? "null") as ReadingPosition;
    if (!p || !Number.isFinite(p.top) || p.top < 0 || p.top > 100_000_000 || !Number.isFinite(p.left) || p.left < 0 || p.left > 100_000_000 || typeof p.revision !== "string") return;
    if (p.page !== undefined && (!Number.isSafeInteger(p.page) || p.page < 1 || p.page > 1_000_000)) return;
    if (p.scale !== undefined && (!Number.isFinite(p.scale) || p.scale <= 0 || p.scale > 100)) return;
    return p;
  } catch { return undefined; }
}
