import type { AttentionTask, HandoffDraft, Lens, ManuscriptNode, Paragraph } from "./types.ts";

export const thinkingLevels = ["Quick", "Light", "Medium", "High", "Maximum"];

export function initialCollapsed(nodes: ManuscriptNode[], activeNodeId: string) {
  const map = new Map(nodes.map((node) => [node.id, node])); const open = new Set<string>();
  for (let node = map.get(activeNodeId); node && !open.has(node.id); node = map.get(node.parentId ?? "")) open.add(node.id);
  return nodes.filter((node) => !open.has(node.id) && nodes.some((child) => child.parentId === node.id)).map((node) => node.id);
}

export function outlineRows(nodes: ManuscriptNode[], lens: Lens, collapsed: string[] = []) {
  const map = new Map(nodes.map((node) => [node.id, node]));
  const included = new Set(nodes.map((node) => node.id));
  if (lens === "proofs") {
    included.clear();
    for (const node of nodes.filter((item) => ["theorem", "lemma", "corollary", "proof"].includes(item.kind))) {
      const seen = new Set<string>();
      for (let current: ManuscriptNode | undefined = node; current && !seen.has(current.id); current = map.get(current.parentId ?? "")) {
        included.add(current.id); seen.add(current.id);
      }
    }
  }
  return nodes.filter((node) => included.has(node.id)).flatMap((node) => {
    const ancestors: string[] = []; const seen = new Set([node.id]);
    for (let parent = map.get(node.parentId ?? ""); parent && !seen.has(parent.id); parent = map.get(parent.parentId ?? "")) {
      seen.add(parent.id); if (included.has(parent.id)) ancestors.push(parent.id);
    }
    if (ancestors.some((id) => collapsed.includes(id))) return [];
    return [{ node, depth: ancestors.length, expandable: nodes.some((child) => child.parentId === node.id && included.has(child.id)) }];
  });
}

export function defaultHandoff(mode: "chatgpt" | "codex", paragraph = false): HandoffDraft {
  return { effort: mode === "chatgpt" ? 2 : 1, scope: paragraph ? "paragraph" : "section", includeProject: true,
    instruction: mode === "chatgpt" ? "Assess the argument and suggest the most useful next revision. Preserve the mathematical claim."
      : "Inspect this passage in the context of the LaTeX project and propose a careful revision. Preserve commands, labels, citations, and math." };
}

export function handoffContinuation(task: AttentionTask | undefined, mode: "chatgpt" | "codex", contextMode: HandoffDraft["contextMode"]) {
  if (!task) return "";
  const parts = ["## Previous request (not checked)", `Task ID: ${task.id}. This is an app task link, not a connection to a model conversation.`];
  if (mode === "codex" && task.ticket) parts.push(`Earlier request: ${task.ticket.promptPath}`, `Original response: ${task.ticket.responsePath}`,
    "You may read those two files for this continuation. The author's edited reply below takes precedence over the original response. Do not modify either file.");
  if (contextMode === "briefing") parts.push("Previous task (context only):", task.packet ?? task.title, "Earlier reply (not checked):", task.reply ?? "No reply saved.");
  else {
    parts.push("Use our existing conversation for unchanged reasoning. If you lack that history, ask for a new-conversation background; do not invent it.");
    if (task.authorEditedReply) parts.push("Author's edited reply (for background, not verification):", task.replyDraft ?? task.reply ?? "");
  }
  return parts.join("\n\n");
}

export function handoffContext(node: ManuscriptNode, nodes: ManuscriptNode[], paragraphs: Paragraph[], edits: Record<string, string>, scope: HandoffDraft["scope"], paragraphId?: string) {
  if (scope === "none" || scope === "auto") return "";
  if (scope === "paragraph") {
    const paragraph = paragraphs.find((item) => item.id === paragraphId);
    return paragraph ? edits[paragraph.id] ?? paragraph.text : "";
  }
  const selected = visiblePreviewNodes(nodes, "paper", node.id);
  const paragraphMap = new Map(paragraphs.map(paragraph => [paragraph.id, paragraph]));
  const titles = new Map(nodes.map((item) => [item.id, item.title]));
  let previous = "";
  return selected.flatMap(item => item.paragraphIds.map(id => paragraphMap.get(id)).filter((p): p is Paragraph => Boolean(p))).map((paragraph) => {
    const heading = previous !== paragraph.nodeId ? `### ${titles.get(paragraph.nodeId) ?? paragraph.nodeId}\n\n` : "";
    previous = paragraph.nodeId;
    return `${heading}${edits[paragraph.id] ?? paragraph.text}`;
  }).join("\n\n");
}

// Document order, not retrieval rank: the lens tells a coherent paper story.
export function themePassages(paragraphs: Paragraph[], ids: string[]) {
  const included = new Set(ids);
  return paragraphs.filter((paragraph) => included.has(paragraph.id));
}

export function themeGap(paragraphs: Paragraph[], before: string, after: string) {
  const start = paragraphs.findIndex((paragraph) => paragraph.id === before);
  const end = paragraphs.findIndex((paragraph) => paragraph.id === after);
  return start >= 0 && end > start ? paragraphs.slice(start + 1, end) : [];
}

export function visiblePreviewNodes(nodes: ManuscriptNode[], lens: Lens, focus?: string, hidden: string[] = []) {
  const map = new Map(nodes.map((node) => [node.id, node]));
  const paired = Boolean(focus && ["theorem", "lemma", "corollary"].includes(map.get(focus)?.kind ?? ""));
  const linked = new Set(paired ? nodes.filter(node => node.kind === "proof" && node.proofFor?.includes(focus!)).map(node => node.id) : []);
  const direct = new Set<string>();
  const visible = nodes.filter((node) => {
    let inFocus = !focus; const seen = new Set<string>();
    let inLinkedProof = false;
    for (let current: ManuscriptNode | undefined = node; current && !seen.has(current.id); current = map.get(current.parentId ?? "")) {
      if (hidden.includes(current.id)) return false;
      if (current.id === focus) inFocus = true;
      if (linked.has(current.id)) inLinkedProof = true;
      seen.add(current.id);
    }
    if (inFocus) direct.add(node.id);
    return (inFocus || inLinkedProof) && (lens !== "proofs" || ["theorem", "lemma", "corollary", "proof"].includes(node.kind));
  });
  // Only a focused statement gets this presentation order. The project and
  // normal section/all-paper views retain their original source order.
  return paired ? [...visible.filter(node => direct.has(node.id)), ...visible.filter(node => !direct.has(node.id))] : visible;
}

/** Headings and paragraph runs in actual expanded source order, not tree order.
 * A section's later prose must not leap ahead of a theorem in that section. */
export function sourceOrderedBlocks(nodes:ManuscriptNode[],paragraphs:Paragraph[]) {
  const map=new Map(nodes.map(n=>[n.id,n])),ranks=new Map<string,number>();
  const active=paragraphs.filter(p=>map.has(p.nodeId));
  active.forEach((p,i)=>{
    const seen=new Set<string>();
    for(let n=map.get(p.nodeId);n && !seen.has(n.id);n=map.get(n.parentId ?? "")){
      seen.add(n.id);ranks.set(n.id,Math.min(ranks.get(n.id) ?? Infinity,i));
    }
  });
  const events=[...nodes.map((node,i)=>({rank:ranks.get(node.id) ?? (ranks.get(nodes.slice(i+1).find(n=>ranks.has(n.id))?.id ?? "") ?? active.length),order:i,node,paragraph:undefined as Paragraph|undefined})),
    ...active.map((paragraph,i)=>({rank:paragraph.emptySource ? ranks.get(paragraph.nodeId)! : i+.5,order:paragraph.emptySource ? nodes.findIndex(n=>n.id===paragraph.nodeId)+.5 : 0,node:map.get(paragraph.nodeId)!,paragraph}))].sort((a,b)=>a.rank-b.rank || a.order-b.order);
  const result:Array<ManuscriptNode & {continued?:boolean;renderKey:string}>=[];
  for(const event of events){
    const previous=result.at(-1);
    if(!event.paragraph)result.push({...event.node,paragraphIds:[],renderKey:event.node.id});
    else if(previous?.id===event.node.id)previous.paragraphIds.push(event.paragraph.id);
    else result.push({...event.node,paragraphIds:[event.paragraph.id],continued:true,renderKey:`${event.node.id}:${event.paragraph.id}`});
  }
  return result;
}
