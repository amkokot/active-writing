import type { HandoffDraft, ManuscriptNode, Paragraph, ProjectDocument, TaskSourceSnapshot } from "./types.ts";
import { locateReturnAnchor } from "./sourceAnchors.ts";

export const sourceSnapshotLimits = { paragraphs: 500, characters: 100_000 };

/** Describe the actual outgoing excerpt, not all the context tracked by an earlier task. */
export function handoffExcerptSummary(scope: HandoffDraft["scope"], text: string, snapshot?: TaskSourceSnapshot) {
  if (scope === "none") return "No new passage included. The prompt still includes your instructions.";
  if (scope === "auto") return text.trim()
    ? `Changed text · ${text.length.toLocaleString()} characters. Preview the prompt to check what's included.`
    : "No new passage included. Unchanged text is left out.";
  if (!text.trim()) return "No passage available. Choose a paragraph or section.";
  const size = `${text.length.toLocaleString()} characters`;
  if (scope === "paragraph") return `Active paragraph only · ${size}. Nearby statements and proofs are not included.`;
  const count = snapshot?.unavailableReason || !snapshot ? "" : `${snapshot.paragraphs.length} paragraphs · `;
  return `Section excerpt · ${count}${size}. Includes results and proofs in this section, not other sections.${snapshot?.unavailableReason ? " This passage is too large to track changes." : ""}`;
}

type SourceParagraph = TaskSourceSnapshot["paragraphs"][number];
export interface SourceMatch {
  before: SourceParagraph;
  after?: SourceParagraph;
  state: "unchanged" | "relocated" | "position-changed" | "missing" | "ambiguous";
}
export interface TaskSourceCheck {
  status: "unknown" | "unavailable" | "unchanged" | "changed" | "relocated" | "missing" | "ambiguous";
  message: string;
  matches: SourceMatch[];
  added: SourceParagraph[];
  target?: { nodeId: string; paragraphId: string; command?: "opening" | "closing" };
  documentChanged?: boolean;
  scopeMissing?: boolean;
  locationUnverified?: boolean;
}

function descendants(document: ProjectDocument, nodeId: string) {
  const included = new Set([nodeId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const node of document.nodes) if (node.parentId && included.has(node.parentId) && !included.has(node.id)) { included.add(node.id); changed = true; }
  }
  return included;
}
function currentParagraphs(document: ProjectDocument, edits: Record<string, string>) {
  return document.paragraphs.map(({ id, nodeId, file, text }) => ({ id, nodeId, file, text: edits[id] ?? text }));
}
export const sourceCommandId = (nodeId: string, command: "opening" | "closing") => `aw-command:${nodeId}:${command}`;
export function sourceCommands(document: ProjectDocument): SourceParagraph[] {
  return document.nodes.flatMap(node => (["opening", "closing"] as const).flatMap(command => {
    const range = command === "opening" ? node.sourceOpening : node.sourceClosing;
    return range ? [{ id: sourceCommandId(node.id, command), nodeId: node.id, file: range.file, text: range.text, command }] : [];
  }));
}
const paragraphKey = (p: SourceParagraph) => JSON.stringify([p.file ?? "", p.command ?? "paragraph", p.text]);
export function captureTaskSource(document: ProjectDocument, node: ManuscriptNode, edits: Record<string, string>, scope: TaskSourceSnapshot["scope"], paragraphId?: string): TaskSourceSnapshot {
  const included = descendants(document, node.id);
  const all = currentParagraphs(document, edits);
  const counts = new Map<string, number>();
  const nodeCounts = new Map<string, number>();
  for (const paragraph of all) { const key = paragraphKey(paragraph); counts.set(key, (counts.get(key) ?? 0) + 1); nodeCounts.set(paragraph.nodeId, (nodeCounts.get(paragraph.nodeId) ?? 0) + 1); }
  const paragraphs = all.filter((p) => scope === "paragraph" ? p.id === paragraphId : included.has(p.nodeId))
    .map((p) => ({ ...p, nodeParagraphCount: nodeCounts.get(p.nodeId), ...((counts.get(paragraphKey(p)) ?? 0) > 1 ? { duplicateAtCapture: true } : {}) }));
  const oversized = paragraphs.length > sourceSnapshotLimits.paragraphs || paragraphs.reduce((size, p) => size + p.text.length, 0) > sourceSnapshotLimits.characters;
  return { version: 1, projectId: document.project.id, revision: document.revision, rootFile: document.project.mainFile, scope,
    nodeId: node.id, nodeTitle: node.title, focusParagraphId: paragraphId, paragraphs: oversized ? [] : paragraphs,
    ...(oversized ? { unavailableReason: "oversized" as const } : {}) };
}

/** No fuzzy matching, cross-file relocation, or silent ordinal-ID fallback. */
export function checkTaskSource(snapshot: TaskSourceSnapshot | undefined, document: ProjectDocument, edits: Record<string, string> = {}): TaskSourceCheck {
  const empty = { matches: [], added: [] };
  if (!snapshot) return { ...empty, status: "unknown", message: "No original passage was saved with this task. Its location can't be checked." };
  if (snapshot.projectId !== document.project.id || snapshot.rootFile !== document.project.mainFile) return { ...empty, status: "unavailable", message: "This task belongs to another paper or main file. Its location isn't guessed." };
  if (snapshot.unavailableReason) return { ...empty, status: "unavailable", message: "This passage was too large to save for comparison. Select a smaller one." };
  if (!snapshot.paragraphs.length) return { ...empty, status: "missing", message: "No passage was saved with this task. Choose one." };
  const paragraphs: SourceParagraph[] = snapshot.paragraphs.some(p => p.command) ? sourceCommands(document) : currentParagraphs(document, edits);
  const nodeCounts = new Map<string, number>();
  for (const paragraph of paragraphs) nodeCounts.set(paragraph.nodeId, (nodeCounts.get(paragraph.nodeId) ?? 0) + 1);
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const byText = new Map<string, SourceParagraph[]>();
  for (const paragraph of paragraphs) {
    const group = byText.get(paragraphKey(paragraph)) ?? []; group.push(paragraph); byText.set(paragraphKey(paragraph), group);
  }
  const matches: SourceMatch[] = snapshot.paragraphs.map((before) => {
    const exact = byText.get(paragraphKey(before)) ?? [];
    const atId = byId.get(before.id);
    // With no disk revision change, editor text changes cannot insert/reorder paragraphs.
    const stable = document.revision === snapshot.revision && atId && atId.file === before.file && atId.nodeId === before.nodeId && atId.text === before.text;
    if ((exact.length > 1 || before.duplicateAtCapture && exact.length) && !stable) return { before, state: "ambiguous" };
    const after = stable ? atId : exact.length === 1 ? exact[0] : undefined;
    return after ? { before, after, state: after.id === before.id && after.nodeId === before.nodeId ? "unchanged" : "relocated" } : { before, state: "missing" };
  });
  const claimed = new Set(matches.flatMap((match) => match.after ? [match.after.id] : []));
  for (const match of matches) {
    if (match.state !== "missing") continue;
    const atId = byId.get(match.before.id);
    const shifted = match.before.nodeParagraphCount !== undefined && nodeCounts.get(match.before.nodeId) !== match.before.nodeParagraphCount
      || matches.some((m) => m.state === "relocated" && m.before.nodeId === match.before.nodeId && m.after?.nodeId === match.before.nodeId && m.before.file === match.before.file);
    if (shifted) continue;
    if (atId && atId.file === match.before.file && atId.nodeId === match.before.nodeId && !claimed.has(atId.id)) {
      // This is a comparison candidate, NOT a verified paragraph identity or a navigation target.
      match.after = atId; match.state = "position-changed"; claimed.add(atId.id);
    }
  }
  const scopeMissing = snapshot.scope === "section" && !document.nodes.some((node) => node.id === snapshot.nodeId);
  const included = descendants(document, snapshot.nodeId);
  const added = snapshot.scope === "section" && !scopeMissing ? paragraphs.filter((p) => included.has(p.nodeId) && !claimed.has(p.id)) : [];
  const focus = matches.find((match) => match.before.id === snapshot.focusParagraphId) ?? matches[0];
  const locationUnverified = snapshot.locationUnverified || matches.some((m) => m.before.locationUnverified);
  const anchored = !snapshot.locationUnverified && !focus?.before.locationUnverified ? locateReturnAnchor(snapshot.returnAnchor, document, edits) : undefined;
  const target = anchored ? { nodeId: anchored.nodeId, paragraphId: anchored.id } : !snapshot.locationUnverified && !focus?.before.locationUnverified && focus?.after && ["unchanged", "relocated"].includes(focus.state) ? { nodeId: focus.after.nodeId, paragraphId: focus.after.id, ...(focus.after.command ? { command: focus.after.command } : {}) } : undefined;
  const status = matches.some((m) => m.state === "ambiguous") ? "ambiguous" : scopeMissing || matches.some((m) => m.state === "missing") ? "missing"
    : added.length || matches.some((m) => m.state === "position-changed") ? "changed" : matches.some((m) => m.state === "relocated") ? "relocated" : "unchanged";
  const documentChanged = document.revision !== snapshot.revision;
  const message = ({ unknown: "", unavailable: "", ambiguous: `Some saved text appears more than once. ${target ? "The selected passage still matches uniquely." : "No unique location was found."}`,
    missing: `Part of the original passage or section can't be found. Replies are kept.${target ? " The selected passage still matches exactly." : " No location is guessed."}`,
    changed: matches.some((m) => m.state === "position-changed") ? "The passage changed. Text at the old position can be compared, but may be a different passage." : "New text appeared in this section. The other saved passages still match.",
    relocated: "The original text moved within the same file.",
    unchanged: locationUnverified ? `The comparison text is unchanged, but some original passages aren't confirmed.${target ? "" : " Choose the passage yourself before returning."}`
      : documentChanged ? "This passage is unchanged; the paper changed elsewhere. Commands and surrounding text aren't checked." : "The saved passage is unchanged." })[status];
  return { status, message, matches, added, target, documentChanged, scopeMissing, locationUnverified };
}

function renderParagraph(p: SourceParagraph, title: string) { return `### ${title} · ${p.file ?? "source file unknown"}\n\n${p.text}`; }

export function sourceHandoffContext(snapshot: TaskSourceSnapshot | undefined, check: TaskSourceCheck, briefing = false) {
  if (["unknown", "unavailable"].includes(check.status)) return `## Source comparison unavailable\n\n${check.message} Request a fresh excerpt if needed; do not infer missing source from history.`;
  const parts: string[] = [];
  for (const match of check.matches) {
    if (match.state === "unchanged" || match.state === "relocated") {
      if (briefing && match.after) parts.push(renderParagraph(match.after, "Current tracked excerpt"));
      else if (match.state === "relocated") parts.push(`The unchanged excerpt moved within ${match.before.file ?? "its source file"}; its current paragraph ID is ${match.after!.id}.`);
    } else if (match.state === "position-changed" && match.after) {
      parts.push(renderParagraph(match.after, "Text now at the original position · identity not verified"));
    } else parts.push(`Original paragraph ${match.before.id} in ${match.before.file ?? "an unknown file"} is ${match.state}. Do not assume its old ordinal ID identifies the same passage.`);
  }
  for (const added of check.added) parts.push(renderParagraph(added, "New excerpt in the tracked section"));
  if (check.scopeMissing) parts.push("The tracked section is no longer identifiable; a complete current section context has not been inferred.");
  if (check.locationUnverified) parts.push("Some previously supplied comparison paragraphs have unverified original source identity. Ask for a fresh selected excerpt before editing affected passages.");
  if (check.documentChanged && !briefing) parts.push(`Paper revision changed since this request. Only tracked excerpt changes are compared; macros, bibliography, and wider context may also have changed. Root: ${snapshot?.rootFile ?? "unknown"}.`);
  return parts.length ? `## ${briefing ? "Current tracked source" : "Source updates since the previous request"}\n\n${parts.join("\n\n")}` : "";
}

/** Capture at export time; only successfully supplied context advances the comparison baseline. */
export function prepareSourceHandoff(document: ProjectDocument, node: ManuscriptNode, edits: Record<string, string>, draft: HandoffDraft, paragraphId?: string, previous?: TaskSourceSnapshot) {
  const check = checkTaskSource(previous, document, edits);
  if (draft.scope === "auto") {
    const context = sourceHandoffContext(previous, check, draft.contextMode === "briefing");
    // Supplied comparisons advance the text baseline, never verify positional identities.
    const safe = previous && !["unknown", "unavailable", "missing", "ambiguous"].includes(check.status);
    const focus = check.matches.find((m) => m.before.id === previous?.focusParagraphId) ?? check.matches[0];
    const root = safe ? document.nodes.find((n) => n.id === (previous.scope === "section" ? previous.nodeId : focus?.after?.nodeId)) : undefined;
    const snapshot = root && previous ? captureTaskSource(document, root, edits, previous.scope, focus?.after?.id) : previous;
    if (snapshot && snapshot !== previous) {
      const uncertain = new Set(check.matches.filter((m) => m.after && (m.state === "position-changed" || m.before.locationUnverified)).map((m) => m.after!.id));
      snapshot.paragraphs = snapshot.paragraphs.map((p) => uncertain.has(p.id) ? { ...p, locationUnverified: true } : p);
      if (previous?.locationUnverified) snapshot.locationUnverified = true;
    }
    return { check, context, snapshot };
  }
  // No pasted excerpt means exactly that, even when source has changed.
  const snapshot = draft.scope === "none" ? previous : captureTaskSource(document, node, edits, draft.scope === "section" ? "section" : "paragraph", paragraphId);
  return { check, context: "", snapshot };
}

export function taskSourceTarget(snapshot: TaskSourceSnapshot | undefined, document: ProjectDocument, edits: Record<string, string>, legacy: { nodeId: string; paragraphId?: string }) {
  if (snapshot) return checkTaskSource(snapshot, document, edits).target;
  // Legacy links have no evidence for rebasing. Only retain their existing, explicitly requested location.
  return document.nodes.some((n) => n.id === legacy.nodeId) ? legacy : undefined;
}
