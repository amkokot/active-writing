// pdfTeX silently manufactures first-page targets for referenced, absent names.
// Keep valid links, but do not mistake these synthetic fallbacks for real results.
export function missingPdfDestinations(log: string): string[] {
  return [...new Set([...log.matchAll(/pdfTeX warning \(dest\):\s*name\{([^}]+)\}\s*has\s+been\s+referenced\s+but\s+does\s+not\s+exis\s*t/g)].map((match) => match[1].replace(/\r?\n\s*/g, "")))].slice(0, 2000);
}

export function unavailablePdfDestination(destination: string | unknown[], unavailable: string[] = []) {
  return typeof destination === "string" && unavailable.includes(destination);
}
/** Friendly suggested names, not paths. Keep Unicode project titles. */
export function pdfDownloadName(requested: string, projectName: string, mainFile: string, focused = false) {
  const root = mainFile.replaceAll("\\", "/").split("/").at(-1)?.replace(/\.tex$/i, "");
  const fallback = `${projectName || "Paper"}${root && root !== "main" ? ` — ${root}` : ""}${focused ? " — focused" : ""}`;
  const clean = (value: string) => value.replace(/\.pdf$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-").trim().replace(/[. ]+$/g, "").slice(0, 160);
  let stem = clean(requested) || clean(fallback) || "Paper";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `Paper — ${stem}`;
  return `${stem}.pdf`;
}

export function compiledPdfDownloadUrl(value: string | undefined, projectId: string, origin: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || !/^\/api\/paperfocus\/pdf\/(focus|full)$/.test(url.pathname) || url.searchParams.get("projectId") !== projectId) return undefined;
    return url.href;
  } catch { return undefined; }
}
