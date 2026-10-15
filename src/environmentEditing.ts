import type { AppState, ProjectDocument, SaveAcknowledgement } from "./types.ts";
import type { QueuedPassage } from "./queueEntries.ts";
import { sectionReminderTarget } from "./queueEntries.ts";

export interface BlockTypes {
  options: NonNullable<ProjectDocument["environmentOptions"]>;
  labels?: ProjectDocument["labels"];
  onChange: (selection: QueuedPassage, environment: string, fields?: EnvironmentFields) => void;
}
export interface EnvironmentFields { description?: string; label?: string }
export interface BlockTypeControl extends BlockTypes { environment?: string; enabled: boolean; title: string }

export function validateEnvironmentFields(fields: EnvironmentFields = {}) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Use description and reference-label fields.");
  if (fields.label !== undefined && (typeof fields.label !== "string" || fields.label.length > 150 || fields.label && !/^[A-Za-z0-9:._/-]+$/.test(fields.label))) throw new Error("Use a reference label without spaces, braces or LaTeX commands.");
  if (fields.description !== undefined) {
    if (typeof fields.description !== "string" || fields.description.length > 500 || /[\r\n]|(?<!\\)%|\\(?:begin|end|label)\s*\{/.test(fields.description)) throw new Error("Use a short description on one line, without environment or label commands.");
    let braces = 0;
    for (let i=0;i<fields.description.length;i++) { const c=fields.description[i]; if(c === "\\") { i++; continue; } if(c === "{") braces++; if(c === "}" && --braces < 0 || c === "]" && !braces) throw new Error("Balance braces and put a literal closing bracket inside braces in the description."); }
    if (braces) throw new Error("Balance braces in the description.");
  }
}
/** Complete a typed opening command only when it occupies a whole ordinary chunk. */
export function completeTypedEnvironment(text: string, caret: number, options: BlockTypes["options"]) {
  const separator = text.lastIndexOf("\n\n", Math.max(0, caret - 1)), start = separator < 0 ? 0 : separator + 2;
  const before = text.slice(start, caret);
  const match = before.match(/^\s*\\begin\s*\{([\w:*-]+)\}$/);
  if (!match || !options.some(o=>o.name===match[1]) || text.slice(caret).trim() || /\\(?:begin|end)\s*\{/.test(text.slice(0,start))) return undefined;
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  return { text: text.slice(0,caret) + `${nl}${nl}\\end{${match[1]}}` + text.slice(caret), caret: caret + nl.length };
}

/** Wrap one source chunk, never half a heading or an existing outer environment. */
export function wrapSourceBlock(text: string, start: number, end: number, quote: string, environment: string, fields: EnvironmentFields = {}) {
  validateEnvironmentFields(fields);
  if (!/^[\w:*-]+$/.test(environment) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > text.length || text.slice(start, end) !== quote) throw new Error("This block changed. Choose its type again.");
  const visible = quote.replace(/(?<!\\)%[^\r\n]*/g, "");
  if (/\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[|\{)/.test(visible)) throw new Error("A section heading cannot be wrapped as a statement. Select its text block instead.");
  const stack: string[] = [];
  for (const match of visible.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
    if (match[1] === "begin") stack.push(match[2]);
    else if (stack.pop() !== match[2]) throw new Error("This block contains an unfinished environment. Finish its source commands first.");
  }
  if (stack.length) throw new Error("This block contains an unfinished environment. Finish its source commands first.");
  // End-of-line comments must not swallow the closing command; use the source's line ending.
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  return text.slice(0, start) + `\\begin{${environment}}${fields.description ? `[${fields.description}]` : ""}${fields.label ? `\\label{${fields.label}}` : ""}${nl}${quote}${nl}\\end{${environment}}` + text.slice(end);
}

/** Rebase environment-only marks through confirmed body ranges, never ordinal IDs. */
export function preserveEnvironmentMarks(state: AppState, before: ProjectDocument, after: ProjectDocument, acknowledgement: SaveAcknowledgement, submitted: Record<string, string> = {}): AppState {
  if (before.project.id !== after.project.id || before.project.mainFile !== after.project.mainFile || acknowledgement.baseRevision !== before.revision || acknowledgement.savedRevision !== after.revision) throw new Error("The changed block's saved version could not be confirmed.");
  const destinations = new Map<string, string>();
  const oldEnvironments = before.nodes.filter(n => n.environment);
  for (const node of oldEnvironments) {
    const candidates = new Set<string>(); let valid = true;
    for (const id of node.paragraphIds) {
      const old = before.paragraphs.find(p => p.id === id), baseline = submitted[id] ?? old?.text;
      const pieces = acknowledgement.paragraphMap[id] ?? [];
      if (!pieces.length && baseline?.trim()) valid = false;
      for (const piece of pieces) {
        const p = after.paragraphs.find(p => p.id === piece.paragraphId), start = piece.targetStart ?? 0;
        if (!old || !p || p.file !== old.file || baseline?.slice(piece.start, piece.end) !== p.text.slice(start, start + piece.end - piece.start)) { valid = false; continue; }
        candidates.add(p.nodeId);
      }
    }
    if (valid && candidates.size === 1) {
      const target = after.nodes.find(n => n.id === [...candidates][0]);
      if (target?.environment) destinations.set(node.id, target.id);
    }
  }
  const progressByNode = { ...state.progressByNode };
  for (const node of oldEnvironments) delete progressByNode[node.id];
  for (const node of oldEnvironments) {
    const progress = state.progressByNode[node.id];
    if (progress) progressByNode[destinations.get(node.id) ?? `unlinked:environment:${before.revision}:${node.id}`] = progress;
  }
  const rebaseIds = (ids: string[]) => ids.flatMap(id => oldEnvironments.some(n => n.id === id) ? destinations.get(id) ? [destinations.get(id)!] : [] : [id]);
  return { ...state, progressByNode, collapsedNodeIds: state.collapsedNodeIds && rebaseIds(state.collapsedNodeIds), hiddenNodeIds: rebaseIds(state.hiddenNodeIds),
    attentionTasks: state.attentionTasks.map(task => {
      const previous = sectionReminderTarget(task, before), id = previous && destinations.get(previous.nodeId);
      const node = id && after.nodes.find(n => n.id === id);
      if (!node || !task.sourceSnapshot) return task;
      // This reminder stores navigation metadata only, not a captured comment or quote.
      return { ...task, nodeId: node.id, title: task.title === task.sourceSnapshot.nodeTitle ? node.title : task.title,
        sourceSnapshot: { ...task.sourceSnapshot, nodeId: node.id, nodeTitle: node.title, revision: after.revision, locationUnverified: false } };
    }) };
}
