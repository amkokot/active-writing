import { editableProject, saveEdits } from "./projects.ts";
import type { SourceEditRange } from "../src/types.ts";
import { randomUUID } from "node:crypto";
import { validateEnvironmentFields, type EnvironmentFields } from "../src/environmentEditing.ts";

/** Change only verified opening/closing tokens, using the normal backup and acknowledgement path. */
export async function changeEnvironment(workspace: string, request: { projectId: string; mainFile: string; revision: string; nodeId: string; environment: string; fields?: EnvironmentFields }) {
  if (!request || ["projectId", "mainFile", "revision", "nodeId", "environment"].some(key => typeof (request as any)[key] !== "string")) throw new Error("Choose a block type in the editor.");
  const parsed = await editableProject(workspace, request.projectId);
  if (!request.revision || parsed.revision !== request.revision || parsed.project.mainFile !== request.mainFile) throw new Error("Source changed outside this editor. Your text is kept; choose its type again after reviewing the change.");
  const node = parsed.nodes.find(n => n.id === request.nodeId), range = parsed.environmentRanges?.[request.nodeId];
  if (!node?.canChangeEnvironment || !range || node.environment !== range.name) throw new Error("This wrapper is incomplete or crosses files. Edit its LaTeX commands in Source instead.");
  if (request.environment && !parsed.environmentOptions?.some(option => option.name === request.environment)) throw new Error("That environment is not declared in this paper's preamble.");
  validateEnvironmentFields(request.fields);
  const primary = parsed.labels.find(label => label.nodeId === node.id);
  if (request.fields?.label && parsed.labels.some(label => label.key === request.fields!.label && label !== primary)) throw new Error("This reference label is already used elsewhere in the paper.");
  if (request.environment === range.name && !request.fields) return parsed;
  if (!request.environment && request.fields) throw new Error("Remove the wrapper separately before editing text labels.");
  const source = parsed.sources[range.file], opening = source.slice(range.start, range.openEnd), closing = source.slice(range.closeStart, range.end);
  const stack: string[] = [];
  for (const match of source.slice(range.start, range.end).replace(/(?<!\\)%[^\r\n]*/g, "").matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
    if (match[1] === "begin") stack.push(match[2]);
    else if (stack.pop() !== match[2]) throw new Error("This wrapper contains mismatched environments. Fix its source commands first.");
  }
  if (stack.length) throw new Error("This wrapper contains an unfinished environment. Fix its source commands first.");
  const begin = opening.match(/^\\begin\s*\{([\w:*-]+)\}/), end = closing.match(/^\\end\s*\{([\w:*-]+)\}$/);
  if (!begin || !end || begin[1] !== range.name || end[1] !== range.name) throw new Error("This wrapper cannot be safely changed. Edit its source commands instead.");
  const openId = `aw-environment-open:${randomUUID()}`, closeId = `aw-environment-close:${randomUUID()}`;
  const nl = source.includes("\r\n") ? "\r\n" : "\n";
  const changes: Record<string,string> = {
    [openId]: request.environment ? request.fields?.description !== undefined ? `\\begin{${request.environment}}${request.fields.description ? `[${request.fields.description}]` : ""}` : opening.replace(begin[0], `\\begin{${request.environment}}`)
      : node.environmentTitle ? `\\textbf{${node.environmentTitle}}\\par${nl}${nl}` : "",
    [closeId]: request.environment ? `\\end{${request.environment}}` : "",
  };
  const ranges: SourceEditRange[] = [
    ...parsed.spans.map(span => ({ paragraphId: span.id, file: span.file, start: span.start, end: span.end, text: span.text })),
    { paragraphId: openId, file: range.file, start: range.start, end: range.openEnd, text: opening },
    { paragraphId: closeId, file: range.file, start: range.closeStart, end: range.end, text: closing },
  ];
  if (request.fields?.label !== undefined && request.fields.label !== (primary?.key ?? "")) {
    if (!primary) { if(request.fields.label) changes[openId] += `\\label{${request.fields.label}}`; }
    else {
      const ownedSpans = parsed.spans.filter(span => node.paragraphIds.includes(span.id) && span.file === range.file);
      const nested = Object.entries(parsed.environmentRanges ?? {}).filter(([id,r]) => id !== node.id && r.file === range.file && r.start > range.start && r.end < range.end).map(([,r])=>r);
      const masked = source.replace(/(?<!\\)%[^\r\n]*/g, comment=>" ".repeat(comment.length));
      const matches = [...masked.slice(range.openEnd,range.closeStart).matchAll(/\\label\s*\{([^}]+)\}/g)].filter(m=>m[1]===primary.key && !nested.some(r=>r.start <= range.openEnd+m.index! && range.openEnd+m.index! < r.end));
      if(matches.length !== 1) throw new Error("This label is ambiguous; edit its source directly. Your text is kept.");
      const match = matches[0], start = range.openEnd+match.index!, end = start+match[0].length;
      const replacement = request.fields.label ? `\\label{${request.fields.label}}` : "";
      const span = ownedSpans.find(s=>s.start <= start && s.end >= end);
      if(span) changes[span.id] = span.text.slice(0,start-span.start)+replacement+span.text.slice(end-span.start);
      else {
        const id = `aw-environment-label:${randomUUID()}`;
        ranges.push({paragraphId:id,file:range.file,start,end,text:source.slice(start,end)}); changes[id]=replacement;
      }
    }
  }
  // Included-file bodies and nested environments remain separate, unchanged ranges.
  return saveEdits(workspace, request.projectId, changes, parsed.revision, ranges, request.mainFile);
}
