import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { geometryMime, animationMime, htmlMime, geometryVisual, imageAnimation, htmlVisual, visualSummary } from "../src/experimentVisual.ts";
import type { ExperimentOutput } from "../src/experiments.ts";
import { explorerMime, explorerVisual } from "../src/experimentExplorer.ts";
/** Read once, retain literal contents plus provenance; never execute an artifact. */
export async function importVisualFile(file: string, title?: string): Promise<ExperimentOutput> {
  const filename = path.resolve(file), info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1_500_000) throw new Error("Use a regular HTML/visual JSON file under 1.5 MB.");
  const raw = await readFile(filename), source = raw.toString("utf8");
  let data: Record<string, unknown>;
  if (/\.html?$/i.test(filename)) {
    const visual = htmlVisual({ version: 1, title: title ?? path.basename(filename), description: "Imported saved visual; no Python run was performed by this import.", html: source, height: 700 });
    if (!visual) throw new Error("Use self-contained HTML under 1 MB and a short title.");
    data = { [htmlMime]: visual };
  } else {
    const value = JSON.parse(source); if (title !== undefined) value.title = title;
    const geometry = geometryVisual(value), animation = imageAnimation(value), html = htmlVisual(value), explorer = explorerVisual(value);
    if (!geometry && !animation && !html && !explorer) throw new Error("Invalid saved visual JSON. Use the documented explorer/geometry/animation/HTML schema.");
    data = explorer ? { [explorerMime]: explorer } : geometry ? { [geometryMime]: geometry } : animation ? { [animationMime]: animation } : { [htmlMime]: html };
  }
  data["text/plain"] = visualSummary(data);
  return { output_type: "display_data", data, metadata: { aw_visual_import: { path: filename, sha256: createHash("sha256").update(raw).digest("hex"), importedAt: new Date().toISOString(), executed: false } } };
}
