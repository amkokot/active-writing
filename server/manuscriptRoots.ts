import path from "node:path";
import { readFile } from "node:fs/promises";

/** Literal TeX containers, not every section file. Never evaluate TeX macros.
 * Shared children can belong to several manuscripts. A cycle retains one root
 * rather than making every manuscript disappear. */
export function manuscriptRoots(sources: Record<string, string>, insensitive = process.platform === "win32") {
  const files = Object.keys(sources), masked = Object.fromEntries(files.map(file => [file, sources[file].replace(/(?<!\\)%[^\r\n]*/g, "")]));
  const resolve = (from: string, target: string) => {
    const input = target.trim().replaceAll("\\", "/"), tex = input.endsWith(".tex") ? input : `${input}.tex`;
    for (const name of [path.posix.normalize(tex), path.posix.normalize(path.posix.join(path.posix.dirname(from), tex))]) {
      if (files.includes(name)) return name;
      if (insensitive) { const matches = files.filter(file => file.toLowerCase() === name.toLowerCase()); if (matches.length === 1) return matches[0]; }
    }
  };
  const children = new Map(files.map(file => [file, [...masked[file].matchAll(/\\(?:input|include)\s*\{([^{}]+)\}/g)].map(match => resolve(file, match[1])).filter((value): value is string => Boolean(value))]));
  const reachable = (file: string) => {
    const seen = new Set<string>(), pending = [file];
    while (pending.length) { const next = pending.pop()!; if (seen.has(next)) continue; seen.add(next); pending.push(...children.get(next) ?? []); }
    return seen;
  };
  const reach = new Map(files.map(file => [file, reachable(file)]));
  const candidates = files.filter(file => /\\documentclass\b/.test(masked[file]) || /\\begin\s*\{document\}/.test(masked[file]) && [...reach.get(file)!].some(child => /\\documentclass\b/.test(masked[child])));
  return candidates.filter(file => !candidates.some(parent => parent !== file && reach.get(parent)!.has(file)
    && (!reach.get(file)!.has(parent) || parent.localeCompare(file) < 0)));
}
export async function discoverManuscriptRoots(root: string, files: string[], known: Record<string, string> = {}) {
  const sources: Record<string, string> = {};
  for (const file of files.filter(file => file.endsWith(".tex"))) sources[file] = known[file] ?? await readFile(path.join(root, file), "utf8");
  return manuscriptRoots(sources);
}
