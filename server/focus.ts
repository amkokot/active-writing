import type { ParsedProject } from "./projects.ts";
import { readFile, writeFile } from "node:fs/promises";
import { restrictNodesToParagraphs } from "../src/manuscriptView.ts";
import { sourceOrderedBlocks, visiblePreviewNodes } from "../src/workspaceTools.ts";

export async function writeFocusedSource(file: string, source: string) {
  let previous: string | undefined;
  try { previous = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (previous === source) return false;
  await writeFile(file, source, "utf8");
  return true;
}


// Hoist only simple, top-level declarations, not definitions scoped inside proofs/groups.
function bodyDeclarations(source: string) {
  const masked = source.replace(/(?<!\\)%[^\r\n]*/g, (match) => " ".repeat(match.length));
  const declarations: string[] = [];
  let braces = 0;
  let scopes = 0;
  for (let i = 0; i < masked.length; i++) {
    const rest = masked.slice(i);
    if (masked[i] === "\\") {
      const scope = rest.match(/^\\(begin|end)\s*\{[^}]*\}|^\\(begingroup|endgroup)\b/);
      if (scope) {
        scopes = Math.max(0, scopes + (scope[1] === "begin" || scope[2] === "begingroup" ? 1 : -1));
        i += scope[0].length - 1; continue;
      }
      const declaration = !braces && !scopes
        ? rest.match(/^\\(?:newcommand|providecommand|DeclareMathOperator)\*?\s*(?:\{\\[A-Za-z@]+\}|\\[A-Za-z@]+)\s*(?:\[[^\]]*\]\s*){0,2}\{/)
        : undefined;
      if (declaration) {
        let depth = 1;
        let end = i + declaration[0].length;
        for (; end < masked.length && depth; end++) {
          if (masked[end] === "\\") { end++; continue; }
          if (masked[end] === "{") depth++;
          if (masked[end] === "}") depth--;
        }
        if (!depth) { declarations.push(source.slice(i, end)); i = end - 1; continue; }
      }
      // Control-symbol braces (\{ and \}) are text, not grouping braces.
      if (!/[A-Za-z@]/.test(masked[i + 1] ?? "")) { i++; continue; }
    }
    if (masked[i] === "{") braces++;
    if (masked[i] === "}") braces = Math.max(0, braces - 1);
  }
  return declarations;
}

interface FocusOptions {
  focusNodeId?: string;
  lens?: string;
  hiddenNodeIds?: string[];
  paragraphIds?: string[];
  cachedAux?: string;
  synchronize?: boolean;
  sectionPages?: boolean;
}
function focusNodes(parsed: ParsedProject, options: FocusOptions) {
  if (options.paragraphIds !== undefined && (!Array.isArray(options.paragraphIds) || !options.paragraphIds.length || options.paragraphIds.length > 10000
    || options.paragraphIds.some(id => typeof id !== "string" || !parsed.paragraphs.some(p => p.id === id)))) {
    throw new Error("This block window is empty or has changed. Choose a window containing text and compile again.");
  }
  const paragraphs = options.paragraphIds ? new Set(options.paragraphIds) : undefined;
  const ancestors = new Set<string>();
  if (options.sectionPages && paragraphs) {
    const nodes = new Map(parsed.nodes.map(n => [n.id, n]));
    for (const paragraph of parsed.paragraphs.filter(p => paragraphs.has(p.id))) {
      const seen = new Set<string>();
      for (let node = nodes.get(paragraph.nodeId); node && !seen.has(node.id); node = nodes.get(node.parentId ?? "")) { seen.add(node.id); ancestors.add(node.id); }
    }
  }
  const selected = visiblePreviewNodes(parsed.nodes, options.lens === "proofs" ? "proofs" : "paper", options.focusNodeId, options.hiddenNodeIds)
    .filter(node => !paragraphs || node.paragraphIds.some(id => paragraphs.has(id)) || ancestors.has(node.id));
  if (!selected.length) throw new Error("This focused view has no visible material. Choose a section or show an item in the outline.");
  return selected;
}

export function focusedSourceSnippets(parsed: ParsedProject, options: FocusOptions) {
  const selected = new Set(focusNodes(parsed, options).flatMap(node => node.paragraphIds));
  const paragraphs = options.paragraphIds ? new Set(options.paragraphIds) : undefined;
  return parsed.paragraphs.filter(p => selected.has(p.id) && (!paragraphs || paragraphs.has(p.id)) && p.renderIssue);
}

export function focusedDocument(parsed: ParsedProject, options: FocusOptions) {
  const selected = focusNodes(parsed, options);
  const paragraphIds = options.paragraphIds ? new Set(options.paragraphIds) : undefined;
  const paragraphMap = new Map(parsed.paragraphs.map(p => [p.id, p]));
  const nodeMap = new Map(parsed.nodes.map(n => [n.id, n]));
  // A node owns prose both before and after its child statements/proofs.
  // Grouping all of that prose first changes the mathematical reading order.
  // Keep deliberate focused-statement/linked-proof presentation, but interleave
  // ordinary all-paper and section builds just like the source/reading panes.
  const environmentFocus = selected.find(node => node.id === options.focusNodeId)?.environment;
  const groups = options.sectionPages && paragraphIds ? sourceOrderedBlocks(selected.map(n => ({ ...n, paragraphIds: n.paragraphIds.filter(id => paragraphIds.has(id)) })), parsed.paragraphs.filter(p => paragraphIds.has(p.id)))
    : paragraphIds ? restrictNodesToParagraphs(selected, parsed.paragraphs.filter(p => paragraphIds.has(p.id)).map(p => p.id))
    : environmentFocus ? selected : sourceOrderedBlocks(selected, parsed.paragraphs);
  const declarations = bodyDeclarations(parsed.body);
  let body = groups.map((node) => {
    const counter = node.environmentCounter;
    const number = node.environmentNumber;
    const reset = counter && number ? "\\ifcsname c@" + counter + "\\endcsname\\setcounter{" + counter + "}{" + (number - 1) + "}\\fi\n" : "";
    const continued = "continued" in node && node.continued;
    // Original unstarred headings increment their own counter. Restore the
    // preceding value for that heading, not the already-incremented snapshot.
    // Continued prose and environments use the snapshot without another step.
    const heading = !continued && !node.environment
      ? node.sourceOpening?.text.match(/^\\(section|subsection|subsubsection|paragraph|subparagraph)(?![A-Za-z*])/)?.[1] : undefined;
    const sections = Object.entries(node.sectionCounters ?? {}).map(([name, value]) => "\\ifcsname c@" + name + "\\endcsname\\setcounter{" + name + "}{" + (heading === name ? value - 1 : value) + "}\\fi\n").join("");
    let snippet = parsed.nodeBodies[node.id];
    if (nodeMap.get(node.id)!.paragraphIds.length) {
      // nodeBodies are generated as prefix + these exact ordered paragraphs +
      // suffix. Replace that body once, retaining headings/environment wrappers.
      // Never search/replace repeated individual prose, and never expand scope.
      const all = nodeMap.get(node.id)!.paragraphIds.map(id => paragraphMap.get(id)!.text).join("\n\n");
      const included = node.paragraphIds.map(id => `${options.synchronize ? `% aw-sync:${id}\n` : ""}${paragraphMap.get(id)!.text}`).join("\n\n");
      const start = snippet.indexOf(all);
      if (!all || start < 0 || snippet.indexOf(all, start + 1) >= 0) throw new Error("The block window's source boundaries could not be confirmed. Use a section view to compile it.");
      snippet = continued && !node.environment ? included : snippet.slice(0, start) + included + snippet.slice(start + all.length);
    }
    for (const p of parsed.paragraphs.filter(p => p.nodeId === node.id && (!paragraphIds || paragraphIds.has(p.id)) && p.renderIssue)) snippet = snippet.replace(p.text, "\\par\\noindent{\\small\\itshape [Unrendered snippet. See source in Active Writing.]}\\par");
    return sections + reset + snippet;
  }).join("\n\n");
  for (const declaration of declarations) body = body.replace(declaration, "");
  // Conference-template initialization belongs to the preview, not the shared paper.
  const templateAdapter = "\\makeatletter\n\\@ifundefined{icml@noticeprintedtrue}{}{\\icml@noticeprintedtrue}\n\\makeatother\n";
  const references = options.cachedAux
    ? "\\makeatletter\n\\@input{" + options.cachedAux + "}\n\\makeatother\n"
    : "";
  const sectionContents = options.sectionPages && options.cachedAux
    ? "\\makeatletter\n\\let\\aw@starttoc\\@starttoc\n\\def\\@starttoc#1{\\def\\aw@ext{#1}\\def\\aw@toc{toc}\\ifx\\aw@ext\\aw@toc\\@input{" + options.cachedAux.replace(/\.aux$/, ".toc") + "}\\else\\aw@starttoc{#1}\\fi}\n\\makeatother\n"
    : "";
  if (!options.cachedAux) {
    const masked = parsed.body.replace(/(?<!\\)%[^\r\n]*/g, (match) => " ".repeat(match.length));
    for (const command of masked.matchAll(/\\bibliography(?:style)?\s*\{[^}]*\}/g)) {
      const original = parsed.body.slice(command.index, command.index! + command[0].length);
      if (!body.includes(original)) body += "\n" + original;
    }
  }
  return parsed.preamble + "\n" + declarations.join("\n") + "\n" + references + "\\begin{document}\n"
    + templateAdapter + sectionContents + body + (options.sectionPages ? "\n\\clearpage" : "") + "\n\\end{document}\n";
}
