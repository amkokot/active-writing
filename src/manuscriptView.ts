import type { AppState, BlockWindow, Lens, ManuscriptNode, ManuscriptScope, Paragraph } from "./types.ts";
import { visiblePreviewNodes } from "./workspaceTools.ts";

export function normalizeBlockWindow(value: unknown): BlockWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const window = value as Partial<BlockWindow>;
  return { radius: [0, 1, 2, 4].includes(window.radius as number) ? window.radius! : 1,
    paragraphId: typeof window.paragraphId === "string" ? window.paragraphId : undefined };
}

export function manuscriptScope(state: Pick<AppState, "blockWindow" | "focusedNodeId">): ManuscriptScope {
  return state.blockWindow ? "window" : state.focusedNodeId ? "section" : "all";
}

/** Inverse synchronization locates source, not an implicit scope-menu action. */
export function locateSourcePassage(state: AppState, nodeId: string, paragraphId: string, nodes: ManuscriptNode[]): AppState {
  const map = new Map(nodes.map(node => [node.id, node])), ancestors = new Set<string>();
  let node = map.get(nodeId), sectionId = nodeId;
  while (node && !ancestors.has(node.id)) {
    ancestors.add(node.id);
    if (node.kind === "section" && !node.environment) sectionId = node.id;
    node = map.get(node.parentId ?? "");
  }
  const focusedNodeId = state.blockWindow || !state.focusedNodeId ? undefined
    : ancestors.has(state.focusedNodeId) ? state.focusedNodeId : sectionId;
  return { ...state, destination: "manuscript", lens: "paper", activeNodeId: nodeId, activeParagraphId: paragraphId, focusedNodeId,
    blockWindow: state.blockWindow ? { ...state.blockWindow, paragraphId } : undefined,
    hiddenNodeIds: state.hiddenNodeIds.filter(id => !ancestors.has(id)),
    collapsedNodeIds: state.collapsedNodeIds?.filter(id => !ancestors.has(id)) };
}

export function adjacentManuscriptSection(nodes: ManuscriptNode[], focusedId: string, hidden: string[], direction: -1 | 1) {
  const current = nodes.find(node => node.id === focusedId);
  if (!current || current.environment || current.id === "document") return;
  const siblings = visiblePreviewNodes(nodes, "paper", undefined, hidden).filter(node => !node.environment && node.id !== "document" && node.kind === current.kind && node.depth === current.depth);
  const index = siblings.findIndex(node => node.id === focusedId);
  return index < 0 ? undefined : siblings[index + direction];
}

export interface SectionEdgeIntent { at: number; started: number; amount: number; sign: number; armed: boolean; cooldown: number }
export function sectionEdgeStep(intent: SectionEdgeIntent, input: {now: number; delta: number; atEdge: boolean; allowed: boolean; blocked: boolean}) {
  const {now, delta} = input, sign = Math.sign(delta), gap = now - intent.at;
  const reset = {...intent, at: now, started: now, amount: 0, sign, armed: false};
  if (!input.atEdge || !input.allowed || input.blocked || !sign || now < intent.cooldown) return {intent: reset, direction: 0};
  // Arrival momentum cannot arm it: an edge requires a fresh gesture after a pause.
  if (!intent.armed || intent.sign !== sign) {
    if (gap < 140) return {intent: reset, direction: 0};
    return {intent: {...reset, amount: Math.abs(delta), armed: true}, direction: 0};
  }
  const next = gap > 800 ? {...reset, amount: Math.abs(delta), armed: true} : {...intent, at: now, amount: intent.amount + Math.abs(delta)};
  if (next.amount < 180 || now - next.started < 120) return {intent: next, direction: 0};
  return {intent: {...reset, cooldown: now + 750}, direction: sign};
}

export function chooseManuscriptScope(state: AppState, scope: ManuscriptScope, nodes: ManuscriptNode[] = []): AppState {
  const map = new Map(nodes.map(node => [node.id, node]));
  let sectionId = state.activeNodeId;
  const seen = new Set<string>();
  for (let node = map.get(state.activeNodeId); node && !seen.has(node.id); node = map.get(node.parentId ?? "")) {
    seen.add(node.id); if (node.kind === "section" && !node.environment) sectionId = node.id;
  }
  return { ...state, lens: state.lens === "themes" ? "paper" : state.lens,
    focusedNodeId: scope === "section" ? sectionId : undefined,
    blockWindow: scope === "window" ? state.blockWindow ?? { radius: 1, paragraphId: state.activeParagraphId } : undefined,
    turbo: { ...state.turbo, enabled: false, reviewingTaskId: undefined, pendingPrompt: undefined } };
}

/** All visible block types, in source order across sections and included files.
 * The window has its own center so editing a neighbor doesn't remove a selection. */
export function manuscriptBlockWindow(nodes: ManuscriptNode[], paragraphs: Paragraph[], lens: Lens, hidden: string[], window: BlockWindow,
  activeParagraphId?: string, activeNodeId?: string) {
  const visible = new Set(visiblePreviewNodes(nodes, lens, undefined, hidden).map(node => node.id));
  const available = paragraphs.filter(p => visible.has(p.nodeId) && !p.emptySource);
  // Editable empty-section placeholders are appended by the parser; place them
  // at their section, not at the end of a pass. Keep real source order intact.
  const positions = new Map(nodes.map((node, index) => [node.id, index]));
  for (const empty of paragraphs.filter(p => visible.has(p.nodeId) && p.emptySource)) {
    const next = available.findIndex(p => (positions.get(p.nodeId) ?? -1) > (positions.get(empty.nodeId) ?? -1));
    available.splice(next < 0 ? available.length : next, 0, empty);
  }
  const ids = [window.paragraphId, activeParagraphId];
  const found = ids.map(id => available.findIndex(p => p.id === id)).find(index => index >= 0);
  const index = Math.max(0, found ?? available.findIndex(p => p.nodeId === activeNodeId));
  const radius = normalizeBlockWindow(window)!.radius;
  const size = Math.min(available.length, radius * 2 + 1);
  const start = Math.max(0, Math.min(index - radius, available.length - size)), end = start + size;
  return { index, radius, available, total: available.length, activeId: available[index]?.id,
    paragraphs: available.slice(start, end), before: start, after: Math.max(0, available.length - end) };
}

export function restrictNodesToParagraphs(nodes: ManuscriptNode[], paragraphIds?: string[]) {
  if (!paragraphIds) return nodes;
  const owners = new Map(nodes.flatMap(node => node.paragraphIds.map(id => [id, node] as const)));
  const groups: ManuscriptNode[] = [];
  const seen = new Set<string>();
  for (const id of paragraphIds) {
    const node = owners.get(id); if (!node || seen.has(id)) continue;
    seen.add(id);
    const previous = groups.at(-1);
    if (previous?.id === node.id) previous.paragraphIds.push(id);
    else groups.push({ ...node, paragraphIds: [id] });
  }
  return groups;
}

export interface WindowScrollIntent { amount: number; at: number; lastAdvance: number }
/** Deliberate scrolling at an edge moves one block, never checks/reviews it. */
export function windowScrollStep(intent: WindowScrollIntent, event: {
  deltaY: number; deltaMode: number; now: number; scrollTop: number; scrollHeight: number; clientHeight: number;
  before: number; after: number; blocked: boolean;
}): { intent: WindowScrollIntent; direction?: -1 | 1 } {
  const direction = event.deltaY > 0 ? 1 : -1;
  const edge = direction === 1 ? event.after > 0 && event.scrollHeight - event.scrollTop - event.clientHeight < 3 : event.before > 0 && event.scrollTop < 3;
  if (event.blocked || !edge || !event.deltaY) return { intent: { ...intent, amount: 0 } };
  const amount = (event.now - intent.at > 300 || Math.sign(intent.amount) !== direction ? 0 : intent.amount)
    + (event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * event.clientHeight : event.deltaY);
  if (Math.abs(amount) >= 110 && event.now - intent.lastAdvance > 900) return { intent: { amount: 0, at: event.now, lastAdvance: event.now }, direction };
  return { intent: { ...intent, amount, at: event.now } };
}
