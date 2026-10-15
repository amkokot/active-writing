import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachProofLinks, explicitProofHeading } from "../src/proofLinks.ts";
import { groupAt } from "../src/references.ts";
import type { DocumentLabel, ManuscriptNode, Paragraph, PaperProject, ProjectDocument, SaveAcknowledgement, SourceEditRange } from "../src/types.ts";
import { parseBibliography, parseInlineBibliography } from "./bibliography.ts";
import { replaceFile } from "./atomicFile.ts";
import { paperAppearance } from "../src/paperAppearance.ts";
import { sectionCommands } from "../src/headingHierarchy.ts";
import { discoverManuscriptRoots } from "./manuscriptRoots.ts";
import { readerSnapshotPaths } from "./readerFolder.ts";
import { sourceBoundaries, sourceChunks } from "../src/sourceChunks.ts";
import { saveGuardedFile } from "./guardedFile.ts";

interface Registry { activeId: string; projects: PaperProject[] }
export interface SourceSpan { id: string; file: string; start: number; end: number; text: string }
export interface EnvironmentRange { file: string; start: number; openEnd: number; closeStart: number; end: number; name: string }
export interface ParsedProject extends ProjectDocument { spans: SourceSpan[]; sources: Record<string, string>; body: string; preamble: string; nodeBodies: Record<string, string>; saveAcknowledgement?: SaveAcknowledgement; environmentRanges?: Record<string, EnvironmentRange> }
export function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
export function inside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
export async function safeFolder(workspace: string, folder: string) {
  const root = await realpath(workspace);
  const resolved = await realpath(path.resolve(workspace, folder));
  if (!inside(root, resolved)) throw new Error("Choose a folder inside this workspace.");
  if (!(await stat(resolved)).isDirectory()) throw new Error("Choose a paper folder.");
  return resolved;
}

export async function registry(workspace: string): Promise<Registry> {
  try { return JSON.parse(await readFile(path.join(workspace, ".paperfocus", "projects.json"), "utf8")); }
  catch { return { activeId: "demo", projects: [{ id: "demo", name: "Measurement error paper", folder: "demo-paper", mainFile: "main.tex", createdAt: new Date().toISOString() }] }; }
}
export async function saveRegistry(workspace: string, value: Registry) {
  await mkdir(path.join(workspace, ".paperfocus"), { recursive: true });
  const target = path.join(workspace, ".paperfocus", "projects.json");
  const temporary = path.join(workspace, ".paperfocus", `projects-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await replaceFile(temporary, target);
}
export async function getProject(workspace: string, id?: string) {
  const entries = await registry(workspace);
  const project = entries.projects.find((item) => item.id === (id ?? entries.activeId));
  if (!project) throw new Error("This paper is no longer registered. Refresh the project list.");
  const root = await safeFolder(workspace, project.folder);
  const source = await readFile(path.join(root, project.mainFile), "utf8");
  const magic = source.match(/%\s*!?\s*TeX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)/i)?.[1]?.toLowerCase() as PaperProject["engine"];
  const engine = project.engine ?? magic ?? (/\\usepackage(?:\[[^\]]*\])?\{[^}]*fontspec[^}]*\}/.test(maskComments(source)) ? "xelatex" : "pdflatex");
  return { project: { ...project, engine }, root };
}
export async function registerProject(workspace: string, folder: string, name?: string) {
  const root = await safeFolder(workspace, folder);
  const relative = path.relative(workspace, root).replaceAll("\\", "/");
  const entries = await registry(workspace);
  const existing = entries.projects.find((item) => item.folder === relative);
  if (existing) return existing;
  const files = await projectFiles(root);
  const roots = await discoverManuscriptRoots(root, files);
  if (!roots.length) throw new Error("No LaTeX root file was found (a .tex file containing \\documentclass).");
  const project: PaperProject = {
    id: randomUUID(), name: name?.trim() || path.basename(root), folder: relative,
    mainFile: roots.includes("main.tex") ? "main.tex" : roots[0], createdAt: new Date().toISOString(),
  };
  entries.projects.push(project);
  await saveRegistry(workspace, entries);
  return project;
}
export async function projectFiles(root: string, relative = "", readerPaths?: Set<string>): Promise<string[]> {
  const result: string[] = [];
  const excluded = readerPaths ?? await readerSnapshotPaths(root);
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if ([".git", ".paperfocus", "node_modules", "dist"].includes(entry.name) || /\.aw-lock$/.test(entry.name) || entry.name.startsWith(".aw-save-") || entry.isSymbolicLink()) continue;
    const file = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    if (excluded.has(file)) continue;
    if (entry.isDirectory()) result.push(...await projectFiles(root, file, excluded));
    else if (entry.isFile()) result.push(file);
    if (result.length > 5000) throw new Error("This repository has too many files. Open the paper's subfolder instead.");
  }
  return result;
}
export async function projectRevision(root: string, files: string[]) {
  const digest = createHash("sha256");
  for (const file of [...files].sort()) { digest.update(`${file}\0`); digest.update(await readFile(path.join(root, file))); }
  return digest.digest("hex");
}
function maskComments(source: string) {
  return source.replace(/(?<!\\)%[^\r\n]*/g, (match) => " ".repeat(match.length));
}
function braced(source: string, open: number) {
  let level = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i - 1] === "\\") continue;
    if (source[i] === "{") level++;
    if (source[i] === "}" && --level === 0) return { text: source.slice(open + 1, i), end: i + 1, closed: true };
  }
  return { text: source.slice(open + 1), end: source.length, closed: false };
}

export function theoremDeclarations(source:string) {
  const masked=maskComments(source),result:Array<{name:string;title:string;counter?:string;within?:string}>=[];
  for(const match of masked.matchAll(/\\newtheorem\b\s*(\*)?\s*/g)){
    let at=match.index!+match[0].length;
    const name=groupAt(masked,at,"{","}");if(!name)continue;
    const nameText=source.slice(at+1,name.end-1);if(!/^[\w:*-]+$/.test(nameText))continue;
    at=name.end;at+=masked.slice(at).match(/^\s*/)?.[0].length ?? 0;
    const sharedStart=at,shared=groupAt(masked,at,"[","]");if(shared){at=shared.end;at+=masked.slice(at).match(/^\s*/)?.[0].length ?? 0;}
    const title=groupAt(masked,at,"{","}");if(!title)continue;
    const titleText=source.slice(at+1,title.end-1);
    at=title.end;at+=masked.slice(at).match(/^\s*/)?.[0].length ?? 0;
    const within=groupAt(masked,at,"[","]");
    if(masked[at]==="[" && !within)continue;
    result.push({name:nameText,title:titleText,counter:match[1]?undefined:shared?source.slice(sharedStart+1,shared.end-1):nameText,within:within?source.slice(at+1,within.end-1):undefined});
  }
  return result;
}

export async function parseProject(workspace: string, id?: string, editing = false, manuscriptFile?: string): Promise<ParsedProject> {
  const found = await getProject(workspace, id), root = found.root;
  const project = manuscriptFile ? { ...found.project, mainFile: manuscriptFile } : found.project;
  if (manuscriptFile && (!inside(root, path.resolve(root, manuscriptFile)) || !manuscriptFile.endsWith(".tex"))) throw new Error("Choose a project TeX root.");
  const files = await projectFiles(root);
  const startingRevision = await projectRevision(root, files);
  const main = await readFile(path.join(root, project.mainFile), "utf8");
  const begin = maskComments(main).indexOf("\\begin{document}");
  const end = maskComments(main).lastIndexOf("\\end{document}");
  if (begin < 0 || end < begin) throw new Error("Choose a root file containing \\begin{document} and \\end{document}.");
  const preambleSources: Record<string, string> = {};
  const preambleVisits = new Set<string>([project.mainFile]);
  const resolveInput = (from: string, input: string) => {
    let relative = input.endsWith(".tex") ? input : `${input}.tex`;
    relative = path.posix.normalize(relative.replaceAll("\\", "/"));
    const candidates = [relative, path.posix.join(path.posix.dirname(from), relative)];
    for (const candidate of candidates) {
      if (files.includes(candidate)) return candidate;
      // Match the host filesystem, not fuzzy source identity. Windows TeX accepts
      // differently cased literal paths; keep the actual original filename.
      if (process.platform === "win32") {
        const matches = files.filter(file => file.toLowerCase() === candidate.toLowerCase());
        if (matches.length === 1) return matches[0];
      }
    }
    return candidates[1];
  };
  const expandPreamble = async (source: string, file: string): Promise<string> => {
    let expanded = ""; let cursor = 0;
    for (const match of maskComments(source).matchAll(/\\input\s*\{([^}]+)\}/g)) {
      expanded += source.slice(cursor, match.index);
      const relative = resolveInput(file, match[1]);
      if (!files.includes(relative) || !inside(root, path.resolve(root, relative))) throw new Error(`The preamble input ${relative} is outside the project or missing.`);
      if (!preambleVisits.has(relative)) {
        preambleVisits.add(relative);
        const text = await readFile(path.join(root, relative), "utf8"); preambleSources[relative] = text;
        expanded += await expandPreamble(text, relative);
      }
      cursor = match.index! + match[0].length;
    }
    return expanded + source.slice(cursor);
  };
  const expandedPreamble = await expandPreamble(main.slice(0, begin), project.mainFile);
  const includeOnlyMatch = maskComments(expandedPreamble).match(/\\includeonly\s*\{([^}]+)\}/);
  const includeOnly = includeOnlyMatch ? new Set(includeOnlyMatch[1].split(",").map((file) => file.trim().replace(/\.tex$/, ""))) : undefined;
  const environments = new Map<string, { title: string; counter?: string; within?: string }>();
  const environmentOptions: NonNullable<ProjectDocument["environmentOptions"]> = [];
  for (const kind of ["theorem", "lemma", "corollary", "proposition", "definition"]) environments.set(kind, { title: kind[0].toUpperCase() + kind.slice(1), counter: kind });
  for (const declaration of theoremDeclarations(expandedPreamble)) {
    environments.set(declaration.name, declaration);
    const old = environmentOptions.findIndex(item => item.name === declaration.name);
    if (old >= 0) environmentOptions.splice(old, 1);
    environmentOptions.push({ name: declaration.name, title: declaration.title });
  }
  if (!environmentOptions.some(option => option.name === "proof") && /\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\bamsthm\b[^}]*\}|\\documentclass(?:\[[^\]]*\])?\s*\{ams(?:art|book|proc)\}/.test(maskComments(expandedPreamble))) environmentOptions.push({ name: "proof", title: "Proof" });
  // aliascnt gives distinct reference names to environments sharing one counter.
  // Resolve literal declarations only; cyclic aliases do not get guessed numbers.
  const counterAliases = new Map([...maskComments(expandedPreamble).matchAll(/\\newaliascnt\s*\{([\w:*-]+)\}\s*\{([\w:*-]+)\}/g)].map((match) => [match[1], match[2]]));
  const resolveCounter = (counter?: string): string | undefined => {
    const visited = new Set<string>();
    while (counter && counterAliases.has(counter)) {
      if (visited.has(counter)) return undefined;
      visited.add(counter); counter = counterAliases.get(counter);
    }
    return counter;
  };
  for (const definition of environments.values()) definition.counter = resolveCounter(definition.counter);
  const environmentPattern = [...new Set(["abstract", "proof", "thebibliography", ...environments.keys()])].map((name) => name.replace(/\*/g, "\\*")).join("|");
  const sources: Record<string, string> = {};
  const nodes: ManuscriptNode[] = [];
  const paragraphs: Paragraph[] = [];
  const spans: SourceSpan[] = [];
  const labels: DocumentLabel[] = [];
  const nodeBodies: Record<string, string> = {};
  const nodePrefixes: Record<string, string> = {};
  const counts: Record<string, number> = {};
  const counterValues: Record<string, number> = {};
  const sectionCounters: Record<string, number> = Object.fromEntries(sectionCommands.map(command => [command, 0]));
  const sectionStack: Array<{ id: string; depth: number }> = [];
  const incompleteSnippets: Array<{ file: string; start: number; message: string }> = [];
  const objectStack: Array<{ id: string; kind: string; file: string; start: number; openEnd: number }> = [];
  const environmentRanges: Record<string, EnvironmentRange> = {};
  let activeId = "document";
  let lastStatementId: string | undefined;
  nodes.push({ id: activeId, title: "Document", kind: "section", depth: 0, paragraphIds: [] });
  const fileVisits = new Set<string>();
  const addParagraph = (file: string, start: number, end: number) => {
    const source = sources[file];
    const labelMatches = [...maskComments(source.slice(start, end)).matchAll(/\\label\s*\{([^}]+)\}/g)].map((match) => ({ key: match[1], offset: start + match.index! }));
    const addLabels = (paragraphId?: string) => labelMatches.forEach((match) => labels.push({ key: match.key, nodeId: activeId, paragraphId, file, line: source.slice(0, match.offset).split(/\r?\n/).length }));
    while (start < end && /\s/.test(source[start])) start++;
    while (end > start && /\s/.test(source[end - 1])) end--;
    const marker = source.slice(start, end).match(/(?:^|\r?\n)%\s*paperfocus:paragraph=([^\s]+)[^\r\n]*\r?\n/);
    if (marker) {
      nodePrefixes[activeId] = (nodePrefixes[activeId] ?? "") + source.slice(start, start + (marker.index ?? 0)) + "\n";
      start += (marker.index ?? 0) + marker[0].length;
    }
    const metadata = source.slice(start, end).match(/^(?:(?:%[^\r\n]*|\\label\{[^}]*\}|\\maketitle|\\appendix)\s*)+/);
    if (metadata) { nodePrefixes[activeId] = (nodePrefixes[activeId] ?? "") + metadata[0]; start += metadata[0].length; }
    if (start === end || !maskComments(source.slice(start, end)).trim()) { addLabels(); return; }
    const text = source.slice(start, end);
    const ordinal = paragraphs.filter((item) => item.nodeId === activeId).length;
    const paragraphId = marker?.[1] ?? `p-${hash(`${file}:${activeId}:${ordinal}`).slice(0, 16)}`;
    addLabels(paragraphId);
    const kind = objectStack.at(-1)?.kind;
    paragraphs.push({ id: paragraphId, ...(marker ? { explicitId: true } : {}), nodeId: activeId, text, file,
      kind: kind === "proof" ? "proof" : kind && kind !== "thebibliography" ? "statement" : "prose" });
    spans.push({ id: paragraphId, file, start, end, text });
    nodes.find((node) => node.id === activeId)!.paragraphIds.push(paragraphId);
  };
  const visit = async (file: string, start = 0, end?: number): Promise<string> => {
    const fullPath = path.resolve(root, file);
    if (!inside(root, fullPath) || !files.includes(file)) throw new Error(`The input file ${file} is outside the project or missing.`);
    if (fileVisits.has(file)) return "";
    fileVisits.add(file);
    sources[file] = await readFile(fullPath, "utf8");
    const source = sources[file];
    const masked = maskComments(source);
    const opaque = sourceBoundaries(source.slice(start, end ?? source.length)).opaque.map(range => ({ start: start + range.start, end: start + range.end }));
    const limit = end ?? source.length;
    const tokens = new RegExp(`\\\\(${sectionCommands.join("|")})(\\*)?\\s*(?:\\[[^\\]]*\\]\\s*)?\\{|\\\\(input|include)\\s*\\{|\\\\(begin|end)\\s*\\{(${environmentPattern})\\}`, "g");
    tokens.lastIndex = start;
    let cursor = start;
    let expanded = "";
    const consume = (to: number) => {
      for (const part of sourceChunks(source.slice(cursor, to), Boolean(objectStack.length))) {
        addParagraph(file, cursor + part.start, cursor + part.end);
      }
      expanded += source.slice(cursor, to);
    };
    let match: RegExpExecArray | null;
    while ((match = tokens.exec(masked)) && match.index < limit) {
      if (opaque.some(range => match!.index > range.start && match!.index < range.end)) continue;
      consume(match.index);
      let tokenEnd = tokens.lastIndex;
      if (match[1]) {
        const title = braced(source, tokenEnd - 1);
        // A half-typed heading is still editable source, not a heading whose
        // title swallows the remainder of the paper. Structure it when closed.
        if (!title.closed || title.end > limit) { incompleteSnippets.push({ file, start: match.index, message: "This heading is unfinished." }); cursor = match.index; continue; }
        tokenEnd = title.end;
        const depth = sectionCommands.indexOf(match[1] as typeof sectionCommands[number]);
        if (!match[2]) {
          sectionCounters[match[1]]++;
          const reset = sectionCommands.slice(depth + 1);
          reset.forEach((counter) => { sectionCounters[counter] = 0; });
          for (const definition of environments.values()) if (definition.counter && definition.within && [match[1], ...reset].includes(definition.within)) counterValues[definition.counter] = 0;
        }
        while (sectionStack.length && sectionStack.at(-1)!.depth >= depth) sectionStack.pop();
        const nodeId = `n-${hash(`${file}:${match[1]}:${title.text}`).slice(0, 14)}-${counts[title.text] = (counts[title.text] ?? 0) + 1}`;
        nodes.push({ id: nodeId, title: title.text, kind: depth ? "subsection" : "section", depth,
          parentId: sectionStack.at(-1)?.id, paragraphIds: [], sectionCounters: { ...sectionCounters }, sourceInsertion: { file, offset: tokenEnd + (source.slice(tokenEnd).match(/^\r?\n/)?.[0].length ?? 0) } });
        nodes.at(-1)!.sourceOpening={file,start:match.index,end:tokenEnd,text:source.slice(match.index,tokenEnd)};
        sectionStack.push({ id: nodeId, depth }); activeId = nodeId; lastStatementId = undefined;
      } else if (match[3]) {
        const input = braced(source, tokenEnd - 1);
        if (!input.closed || input.end > limit) { incompleteSnippets.push({ file, start: match.index, message: "This input command is unfinished." }); cursor = match.index; continue; }
        tokenEnd = input.end;
        if (match[3] === "include" && includeOnly && !includeOnly.has(input.text.replace(/\.tex$/, ""))) { cursor = tokenEnd; tokens.lastIndex = tokenEnd; continue; }
        const relative = resolveInput(file, input.text);
        if (editing && (!files.includes(relative) || !inside(root, path.resolve(root, relative)))) {
          // Keep only the unavailable snippet as source; surrounding blocks are
          // still parseable. Never follow a missing or out-of-project path.
          const count = paragraphs.length; addParagraph(file, match.index, tokenEnd);
          if (paragraphs.length > count) paragraphs.at(-1)!.renderIssue = `Input ${input.text} is not available in this project.`;
          expanded += source.slice(match.index, tokenEnd); cursor = tokenEnd; tokens.lastIndex = tokenEnd; continue;
        }
        expanded += await visit(relative);
        cursor = tokenEnd; tokens.lastIndex = tokenEnd; continue;
      } else if (match[4] === "begin") {
        const kind = match[5];
        const optionStart = tokenEnd + (source.slice(tokenEnd).match(/^\s*/)?.[0].length ?? 0);
        const option = groupAt(masked, optionStart, "[", "]");
        const optional = option ? source.slice(optionStart + 1, option.end - 1) : undefined;
        if (option) tokenEnd = option.end;
        const nodeId = `n-${hash(`${file}:${kind}:${counts[kind] = (counts[kind] ?? 0) + 1}`).slice(0, 16)}`;
        const normalized = ["abstract", "thebibliography"].includes(kind) ? "section" : ["theorem", "lemma", "corollary", "proof"].includes(kind) ? kind : "theorem";
        const definition = environments.get(kind);
        const number = definition?.counter ? counterValues[definition.counter] = (counterValues[definition.counter] ?? 0) + 1 : undefined;
        const within = definition?.within ?? (definition?.counter ? environments.get(definition.counter)?.within : undefined);
        const withinDepth = sectionCommands.indexOf(within as typeof sectionCommands[number]);
        const displayedNumber = number && withinDepth >= 0 ? [...Object.values(sectionCounters).slice(0, withinDepth + 1), number].join(".") : number;
        const title = `${definition?.title ?? (kind === "abstract" ? "Abstract" : kind === "thebibliography" ? "References" : "Proof")}${displayedNumber ? ` ${displayedNumber}` : ""}${optional ? ` · ${optional}` : ""}`;
        nodes.push({ id: nodeId, title, kind: normalized as ManuscriptNode["kind"],
          parentId: kind === "thebibliography" ? undefined : objectStack.at(-1)?.id ?? (kind === "proof" && !explicitProofHeading(optional) ? lastStatementId : undefined) ?? sectionStack.at(-1)?.id, depth: ["abstract", "thebibliography"].includes(kind) ? 0 : 2, paragraphIds: [],
          environment: kind, environmentTitle: optional, environmentCounter: definition?.counter, environmentNumber: number, sectionCounters: { ...sectionCounters }, sourceInsertion: { file, offset: tokenEnd + (source.slice(tokenEnd).match(/^\r?\n/)?.[0].length ?? 0) } });
        nodes.at(-1)!.sourceOpening={file,start:match.index,end:tokenEnd,text:source.slice(match.index,tokenEnd)};
        if (kind !== "proof" && kind !== "abstract") lastStatementId = nodeId;
        objectStack.push({ id: nodeId, kind, file, start: match.index, openEnd: tokenEnd }); activeId = nodeId;
      } else {
        const opened = objectStack.pop();
        if (opened && opened.kind === match[5] && opened.file === file) {
          environmentRanges[opened.id] = { file, start: opened.start, openEnd: opened.openEnd, closeStart: match.index, end: tokenEnd, name: opened.kind };
          const node = nodes.find(node => node.id === opened.id);
          if(node)node.sourceClosing={file,start:match.index,end:tokenEnd,text:source.slice(match.index,tokenEnd)};
          if (node && !["abstract", "thebibliography"].includes(opened.kind)) node.canChangeEnvironment = true;
        }
        activeId = objectStack.at(-1)?.id ?? sectionStack.at(-1)?.id ?? "document";
      }
      expanded += source.slice(match.index, tokenEnd);
      cursor = tokenEnd; tokens.lastIndex = tokenEnd;
    }
    consume(limit);
    return expanded;
  };
  const body = await visit(project.mainFile, begin + "\\begin{document}".length, end);
  // A preserved marker may have been a generated ordinal ID in an earlier
  // revision. After insertion, that ordinal can now belong to another block.
  // Reserve explicit IDs across all included files before exposing edit keys.
  const explicitIds = new Set(paragraphs.filter(p => p.explicitId).map(p => p.id));
  const usedIds = new Set(paragraphs.map(p => p.id));
  paragraphs.forEach((paragraph, index) => {
    if (paragraph.explicitId || !explicitIds.has(paragraph.id)) return;
    const span = spans[index], oldId = paragraph.id;
    let attempt = 0, newId: string;
    do { newId = `p-${hash(`generated:${span.file}:${paragraph.nodeId}:${span.start}:${++attempt}`).slice(0, 16)}`; } while (usedIds.has(newId));
    usedIds.add(newId); paragraph.id = newId; span.id = newId;
    const startLine = sources[span.file].slice(0, span.start).split(/\r?\n/).length;
    const endLine = sources[span.file].slice(0, span.end).split(/\r?\n/).length;
    for (const label of labels) if (label.paragraphId === oldId && label.file === span.file && label.nodeId === paragraph.nodeId && label.line >= startLine && label.line <= endLine) label.paragraphId = newId;
  });
  for (const node of nodes) node.paragraphIds = paragraphs.filter(p => p.nodeId === node.id).map(p => p.id);
  attachProofLinks(nodes, labels);
  Object.assign(sources, preambleSources);
  for (const issue of incompleteSnippets) {
    const span = spans.find(span => span.file === issue.file && span.start <= issue.start && span.end > issue.start);
    const paragraph = span && paragraphs.find(p => p.id === span.id);
    if (paragraph) paragraph.renderIssue = issue.message;
  }
  for (const node of nodes) {
    node.sourceLastParagraphId=node.paragraphIds.at(-1);
    const first=spans.find(span=>span.id===node.paragraphIds[0]),opening=node.sourceOpening;
    if(first && opening && first.file===opening.file && first.start>=opening.end){
      const prefix=sources[first.file].slice(opening.end,first.start);
      if(/^(?:\s|%[^\r\n]*(?:\r?\n|$)|\\label\s*\{[^}]*\})*$/.test(prefix)){
        const literal=sources[first.file].slice(opening.start,first.start).trimEnd();
        node.sourceOpening={...opening,end:opening.start+literal.length,text:literal};
      }
    }
    let text = (nodePrefixes[node.id] ? `${nodePrefixes[node.id]}\n` : "") + node.paragraphIds.map((id) => paragraphs.find((p) => p.id === id)!.text).join("\n\n");
    if (node.environment) {
      text = `\\begin{${node.environment}}${node.environmentTitle ? `[${node.environmentTitle}]` : ""}\n${text}\n\\end{${node.environment}}`;
    } else if (node.id !== "document") text = `\\${sectionCommands[node.depth] ?? "section"}*{${node.title}}\n${text}`;
    nodeBodies[node.id] = text;
  }
  const rootFiles = await discoverManuscriptRoots(root, files, sources);
  const bibliographyCommands = [...maskComments(expandedPreamble + "\n" + body).matchAll(/\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)];
  const declaredBibliographies = bibliographyCommands.flatMap((match) => match[1].split(",").map((name) => {
    const filename = name.trim().endsWith(".bib") ? name.trim() : name.trim() + ".bib";
    return files.includes(filename) ? filename : path.posix.join(path.posix.dirname(project.mainFile), filename);
  }));
  const bibliographyFiles = bibliographyCommands.length ? [...new Set(declaredBibliographies.filter((file) => files.includes(file)))] : files.filter((file) => file.endsWith(".bib"));
  const bibEntries = (await Promise.all(bibliographyFiles.map(async (file) => parseBibliography(await readFile(path.join(root, file), "utf8"), file)))).flat();
  const inlineEntries = Object.entries(sources).flatMap(([file, text]) => parseInlineBibliography(text, file));
  const citations = [...new Map([...inlineEntries, ...bibEntries].map((entry) => [entry.key, entry])).values()];
  const finalFiles = await projectFiles(root);
  const revision = await projectRevision(root, finalFiles);
  if (revision !== startingRevision || JSON.stringify([...files].sort()) !== JSON.stringify([...finalFiles].sort())) {
    throw new Error("Source files changed while being read. Try again once the collaborator or agent finishes writing.");
  }
  return { project, files, rootFiles,
    nodes: nodes.filter((node) => node.id !== "document" || node.paragraphIds.length), paragraphs,
    revision, spans, sources, body, preamble: main.slice(0, begin), nodeBodies, labels, citations, sourceFiles: Object.keys(sources), appearance: paperAppearance(expandedPreamble), environmentOptions, environmentRanges };
}

/** Source can always be edited, even if the outline cannot yet understand it. */
export async function editableProject(workspace: string, id?: string): Promise<ParsedProject> {
  try {
    const parsed = await parseProject(workspace, id, true);
    if (!parsed.nodes.length) {
      const source = parsed.sources[parsed.project.mainFile]; const offset = source.indexOf("\\begin{document}") + "\\begin{document}".length;
      parsed.nodes.push({ id: "document", title: "Document", kind: "section", depth: 0, paragraphIds: [], sourceInsertion: { file: parsed.project.mainFile, offset } });
    }
    for (const node of parsed.nodes) if (!node.paragraphIds.length && node.sourceInsertion) {
      const { file, offset } = node.sourceInsertion, paragraphId = `empty-${node.id}`;
      node.paragraphIds.push(paragraphId); parsed.paragraphs.push({ id: paragraphId, nodeId: node.id, file, text: "", emptySource: true });
      node.sourceLastParagraphId=paragraphId;
      parsed.spans.push({ id: paragraphId, file, start: offset, end: offset, text: "" });
    }
    return parsed;
  }
  catch (error) {
    const { project, root } = await getProject(workspace, id), files = await projectFiles(root);
    const revision = await projectRevision(root, files), sources: Record<string, string> = {};
    const paragraphs: Paragraph[] = [], spans: SourceSpan[] = [], nodes: ManuscriptNode[] = [], nodeBodies: Record<string, string> = {};
    const issue = error instanceof Error ? error.message : String(error);
    for (const file of files.filter(file => file.endsWith(".tex")).sort((a, b) => Number(b === project.mainFile) - Number(a === project.mainFile))) {
      const text = await readFile(path.join(root, file), "utf8"); sources[file] = text;
      const nodeId = `file-${hash(file).slice(0, 14)}`, paragraphId = `source-${hash(file).slice(0, 14)}`;
      nodes.push({ id: nodeId, title: file, depth: 0, kind: "section", paragraphIds: [paragraphId] }); nodeBodies[nodeId] = text;
      paragraphs.push({ id: paragraphId, nodeId, file, text, renderIssue: issue }); spans.push({ id: paragraphId, file, start: 0, end: text.length, text });
    }
    if (revision !== await projectRevision(root, await projectFiles(root))) throw new Error("Source files changed while being read. Try again after the other app finishes writing.");
    const rootFiles = [...new Set([project.mainFile, ...await discoverManuscriptRoots(root, files, sources)])];
    return { project, files, rootFiles, revision, nodes, paragraphs, spans, sources, body: sources[project.mainFile] ?? "", preamble: "", nodeBodies, sourceFiles: Object.keys(sources), structureIssue: issue };
  }
}

export async function saveEdits(workspace: string, id: string | undefined, edits: Record<string, string>, expectedRevision?: string, sourceRanges?: SourceEditRange[], expectedMainFile?: string) {
  if (expectedMainFile && (await getProject(workspace, id)).project.mainFile !== expectedMainFile) throw new Error("The main file changed in another window. The draft is kept; open the paper again.");
  let parsed: ParsedProject;
  if (sourceRanges) {
    // Continue edits to the same raw source region, even if its parsed sections
    // changed during the previous save. Exact text and revision fence ownership.
    const { project, root } = await getProject(workspace, id), files = await projectFiles(root), revision = await projectRevision(root, files);
    if (!expectedRevision || revision !== expectedRevision) throw new Error("The source changed on disk. Review file changes before saving so collaborator changes are preserved.");
    if (!Array.isArray(sourceRanges) || sourceRanges.length > 20000) throw new Error("Invalid source edit ranges.");
    const sources: Record<string, string> = {}, spans: SourceSpan[] = [], ids = new Set<string>();
    for (const range of sourceRanges) {
      if (!range || typeof range.paragraphId !== "string" || ids.has(range.paragraphId) || typeof range.file !== "string" || !range.file.endsWith(".tex") || !files.includes(range.file) || !inside(root, path.resolve(root, range.file))
        || typeof range.text !== "string" || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start) throw new Error("Invalid source edit range.");
      ids.add(range.paragraphId); sources[range.file] ??= await readFile(path.join(root, range.file), "utf8");
      if (range.end > sources[range.file].length || sources[range.file].slice(range.start, range.end) !== range.text) throw new Error("The source region changed outside this editor. Review file changes before saving.");
      spans.push({ id: range.paragraphId, file: range.file, start: range.start, end: range.end, text: range.text });
    }
    for (const file of Object.keys(sources)) { let end = -1; for (const span of spans.filter(s => s.file === file).sort((a, b) => a.start - b.start)) { if (span.start < end) throw new Error("Source edit ranges overlap."); end = span.end; } }
    parsed = { project, files, rootFiles: [project.mainFile], revision, sources, spans, paragraphs: [], nodes: [], body: "", preamble: "", nodeBodies: {} };
  } else parsed = await editableProject(workspace, id);
  if (expectedRevision && parsed.revision !== expectedRevision) throw new Error("The source changed on disk. Reload the paper before saving so collaborator changes are preserved.");
  const { root } = await getProject(workspace, id);
  if (!edits || typeof edits !== "object" || Array.isArray(edits) || Object.values(edits).some(text => typeof text !== "string")) throw new Error("Edits must be source text.");
  if (await projectRevision(root, await projectFiles(root)) !== parsed.revision) throw new Error("Source changed outside this editor while saving. Your draft is kept.");
  for (const paragraphId of Object.keys(edits)) if (!parsed.spans.some((span) => span.id === paragraphId)) throw new Error("A passage moved on disk. Reload this paper before saving.");
  const expectedSources: Record<string, string> = {};
  const ranges: SourceEditRange[] = [];
  const sourceReplacements = new Map<string, string>();
  for (const file of Object.keys(parsed.sources)) {
    let source = parsed.sources[file];
    let shift = 0;
    for (const span of parsed.spans.filter(item => item.file === file).sort((a, b) => a.start - b.start)) {
      const replacement = edits[span.id] ?? span.text;
      const insertion = span.start === span.end && replacement.length > 0;
      const prefix = insertion && span.start > 0 && !/[\r\n]/.test(source[span.start - 1]) ? "\n" : "";
      const suffix = insertion && span.end < source.length && !/[\r\n]/.test(source[span.end]) ? "\n" : "";
      sourceReplacements.set(span.id, prefix + replacement + suffix);
      const start = span.start + shift + prefix.length;
      ranges.push({ paragraphId: span.id, file, start, end: start + replacement.length, text: replacement });
      shift += prefix.length + replacement.length + suffix.length - span.text.length;
    }
    const changes = parsed.spans.filter((span) => span.file === file && edits[span.id] !== undefined).sort((a, b) => b.start - a.start);
    for (const span of changes) source = source.slice(0, span.start) + sourceReplacements.get(span.id)! + source.slice(span.end);
    expectedSources[file] = source;
    if (source !== parsed.sources[file]) {
      const backup = path.join(workspace, ".paperfocus", "backups", parsed.project.id, `${Date.now()}-${hash(file).slice(0, 8)}.tex`);
      await mkdir(path.dirname(backup), { recursive: true }); await writeFile(backup, parsed.sources[file], "utf8");
      await saveGuardedFile(root, file, createHash("sha256").update(parsed.sources[file]).digest("hex"), Buffer.from(source));
    }
  }
  const saved = await editableProject(workspace, id);
  for (const [file, source] of Object.entries(expectedSources)) if ((saved.sources[file] ?? await readFile(path.join(root, file), "utf8")) !== source) {
    throw new Error("Source changed while the save was being confirmed. Your draft and the backup are kept; review file changes before continuing.");
  }
  const paragraphMap: SaveAcknowledgement["paragraphMap"] = {};
  const emptySpanIds = new Set(parsed.spans.filter(span => span.text === "").map(span => span.id));
  for (const range of ranges) {
    // A replacement can introduce headings or several paragraphs. Position, not
    // repeated wording or an ordinal, identifies exactly where each piece went.
    const wasEmpty = emptySpanIds.has(range.paragraphId);
    paragraphMap[range.paragraphId] = saved.spans.filter(span => span.file === range.file && (span.end > range.start && span.start < range.end
      || wasEmpty && range.start === range.end && span.start === span.end && span.start === range.start))
      .map(span => ({ paragraphId: span.id, start: Math.max(span.start, range.start) - range.start, end: Math.min(span.end, range.end) - range.start, targetStart: Math.max(span.start, range.start) - span.start }));
  }
  saved.saveAcknowledgement = { baseRevision: parsed.revision, savedRevision: saved.revision, paragraphMap, sourceRanges: ranges };
  return saved;
}

export function publicDocument(parsed: ParsedProject): ProjectDocument {
  const { project, files, rootFiles, nodes, paragraphs, revision, labels, citations, sourceFiles, appearance, structureIssue, environmentOptions } = parsed;
  return { project, files, rootFiles, nodes, paragraphs, revision, labels, citations, sourceFiles, appearance, structureIssue, environmentOptions };
}

/** Lazy, revision-bound raw source for the file editor, including the preamble. */
export async function readSourceFile(workspace:string,id:string|undefined,file:string) {
  const parsed=await editableProject(workspace,id),{root}=await getProject(workspace,id);
  if(!file.endsWith(".tex") || !parsed.files.includes(file) || !inside(root,path.resolve(root,file)))throw new Error("Choose a LaTeX file in this paper.");
  const source=parsed.sources[file] ?? await readFile(path.join(root,file),"utf8");
  if(await projectRevision(root,await projectFiles(root))!==parsed.revision)throw new Error("Files changed while reading. Try opening this file again.");
  return {file,source,revision:parsed.revision,mainFile:parsed.project.mainFile,positions:parsed.spans.filter(span=>span.file===file).map(span=>({paragraphId:span.id,nodeId:parsed.paragraphs.find(p=>p.id===span.id)?.nodeId,start:span.start,end:span.end}))};
}
