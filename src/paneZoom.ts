export const paneZoomLimits = { min: 0.5, max: 2.5 };
/** Bound a PDF page's backing bitmap to 32 MB, regardless of monitor DPI or
 * zoom. CSS dimensions and source coordinates keep their original scale. */
export function pdfRasterSize(width: number, height: number, pixelRatio: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("Invalid PDF page dimensions.");
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? Math.min(pixelRatio, 2) : 1;
  const scale = Math.min(ratio, Math.sqrt(8_000_000 / width / height), 8192 / width, 8192 / height);
  return { scale, width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
export function clampPaneZoom(value: number) {
  return Number.isFinite(value) ? Math.min(paneZoomLimits.max, Math.max(paneZoomLimits.min, value)) : 1;
}
export function wheelPaneZoom(current: number, delta: number, mode = 0) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? 240 : 1);
  return clampPaneZoom(current * Math.exp(-Math.max(-160, Math.min(160, pixels)) * 0.002));
}
export function paneZoomKey(key: string): "in" | "out" | "reset" | undefined {
  return key === "+" || key === "=" ? "in" : key === "-" || key === "_" ? "out" : key === "0" ? "reset" : undefined;
}
export function loadPaneZoom(key: string, storage?: Pick<Storage, "getItem">) {
  try {
    const stored = storage?.getItem(`active-writing.zoom.${key}`);
    return stored === null || stored === undefined || !stored.trim() ? 1 : clampPaneZoom(Number(stored));
  } catch { return 1; }
}
export function savePaneZoom(key: string, value: number, storage?: Pick<Storage, "setItem">) {
  try { storage?.setItem(`active-writing.zoom.${key}`, String(clampPaneZoom(value))); } catch { /* Zoom must work when storage is unavailable. */ }
}
