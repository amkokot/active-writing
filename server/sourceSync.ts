import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { inside, type ParsedProject } from "./projects.ts";
import { run } from "./commands.ts";

export interface CompiledSourceRange { paragraphId: string; file: string; startLine: number; endLine: number }
export function sourceLine(text: string, offset: number) { return text.slice(0, offset).split(/\r?\n/).length; }
export function sourcePath(file: string) {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function compiledSourceRanges(parsed: ParsedProject, shadow?: string): CompiledSourceRange[] {
  if (!shadow) return parsed.spans.filter(span => span.text).map(span => ({ paragraphId: span.id, file: span.file,
    startLine: sourceLine(parsed.sources[span.file], span.start), endLine: sourceLine(parsed.sources[span.file], span.end) }));
  const markers = [...shadow.matchAll(/^% aw-sync:([^\s]+)\r?$/gm)];
  return markers.map((marker, index) => {
    const paragraph = parsed.paragraphs.find(p => p.id === marker[1]);
    const startLine = sourceLine(shadow, marker.index!) + 1;
    return { paragraphId: marker[1], file: ".paperfocus-focus", startLine,
      endLine: Math.min(startLine + (paragraph?.text.split(/\r?\n/).length ?? 1) - 1, sourceLine(shadow, markers[index + 1]?.index ?? shadow.length) - 1) };
  });
}

/** Index only file/line/page membership; SyncTeX itself handles geometric queries. */
export function syncPageIndex(text: string, root: string) {
  const files = new Map<string, string>();
  const result = new Map<string, Map<number, Set<number>>>();
  let page = 0;
  for (const line of text.split(/\r?\n/)) {
    const input = line.match(/^Input:(\d+):(.*)$/);
    if (input) { files.set(input[1], path.resolve(root, input[2])); continue; }
    const sheet = line.match(/^\{(\d+)$/); if (sheet) { page = Number(sheet[1]); continue; }
    if (line === "}") { page = 0; continue; }
    // SyncTeX boxes, glue, kerns, rules and math nodes carry input tag + line.
    const node = page && line.match(/^[\[\(vhxkg$r]([0-9]+),([0-9]+)(?::|,)/);
    if (!node) continue;
    const inputFile = files.get(node[1]); if (!inputFile || !inside(root, inputFile)) continue;
    const file = sourcePath(inputFile);
    if (!result.has(file)) result.set(file, new Map());
    const lines = result.get(file)!; const number = Number(node[2]);
    if (!lines.has(number)) lines.set(number, new Set()); lines.get(number)!.add(page);
  }
  return result;
}

export async function pagesForSource(root: string, syncFile: string, ranges: CompiledSourceRange[]) {
  const compressed = await readFile(syncFile);
  const index = syncPageIndex(gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8"), root);
  const pages = new Set<number>();
  for (const range of ranges) {
    const lines = index.get(sourcePath(path.resolve(root, range.file))); if (!lines) continue;
    for (const [line, mapped] of lines) if (line >= range.startLine && line <= range.endLine) for (const page of mapped) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

export function syncRecords(output: string) {
  const records: Record<string, string>[] = []; let current: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    if (/^(?:Output|Input):/.test(line) && (current.Output || current.Input)) { records.push(current); current = {}; }
    const field = line.match(/^([A-Za-z]+):(.*)$/); if (field) current[field[1]] = field[2].trim();
  }
  if (current.Output || current.Input) records.push(current);
  // Inverse queries print an Output header before the actual Input records.
  // A header alone is not a navigation candidate.
  return records.filter(record => record.Output && record.Page || record.Input && record.Line);
}
export async function querySync(root: string, direction: "view" | "edit", spec: string, pdf: string) {
  // Never inherit an external editor/viewer command from the user's environment.
  const result = await run("synctex", direction === "view" ? ["view", "-i", spec, "-o", pdf] : ["edit", "-o", `${spec}:${pdf}`], root,
    { timeoutMs: 10000, env: { SYNCTEX_EDITOR: "", SYNCTEX_VIEWER: "" } });
  if (result.code !== 0) throw new Error("Source linking is unavailable for this PDF. Compile again to create its SyncTeX map.");
  return syncRecords(result.output);
}
