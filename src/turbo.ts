import { fingerprint } from "./rewrite.ts";
import type { ManuscriptNode, Paragraph, TurboState, TurboReview } from "./types.ts";

export function freshTurbo(): TurboState {
  return { enabled: false, context: 1, autoCheck: true, includeTechnical: false, atEnd: false, reviews: {}, history: [] };
}

// This is a conservative prose filter, not a TeX interpreter. The all-blocks
// option exposes front matter, figures, algorithms, and structural-only spans.
export function turboPass(paragraphs: Paragraph[], nodes: ManuscriptNode[], hidden: string[], includeTechnical: boolean): Paragraph[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return paragraphs.filter((paragraph) => {
    if (paragraph.emptySource) return false;
    const visited = new Set<string>();
    for (let node = nodeMap.get(paragraph.nodeId); node && !visited.has(node.id); node = node.parentId ? nodeMap.get(node.parentId) : undefined) {
      if (hidden.includes(node.id)) return false;
      if (!includeTechnical && node.environment === "thebibliography") return false;
      visited.add(node.id);
    }
    if (includeTechnical) return true;
    if (paragraph.nodeId === "document" || /\\begin\{(?:figure\*?|table\*?|algorithm\w*|tikzpicture|equation\*?|align\*?)\}|\\(?:bibitem|bibliography|bibliographystyle|printbibliography)\b/.test(paragraph.text)) return false;
    const prose = paragraph.text.replace(/%[^\n]*/g, "").replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, "")
      .replace(/\\[a-zA-Z@]+\*?(?:\s*\[[^\]]*\])?(?:\s*\{[^{}]*\})*/g, "");
    return (prose.match(/[a-zA-Z]{2,}/g) ?? []).length >= 3;
  });
}

export function reviewed(turbo: TurboState, id: string, text: string) {
  return turbo.reviews[id]?.fingerprint === fingerprint(text);
}

export function checkParagraph(turbo: TurboState, paragraphId: string, text: string, reason: TurboReview["reason"]): TurboState {
  return { ...turbo, reviews: { ...turbo.reviews, [paragraphId]: { fingerprint: fingerprint(text), checkedAt: new Date().toISOString(), reason } },
    history: [...turbo.history.slice(-24), { paragraphId, previous: turbo.reviews[paragraphId] }] };
}

export function undoCheck(turbo: TurboState): TurboState {
  const last = turbo.history.at(-1);
  if (!last) return turbo;
  const reviews = { ...turbo.reviews };
  if (last.previous) reviews[last.paragraphId] = last.previous;
  else delete reviews[last.paragraphId];
  return { ...turbo, reviews, history: turbo.history.slice(0, -1), activeParagraphId: last.paragraphId, atEnd: false };
}

export function contextWindow(pass: Paragraph[], activeId: string | undefined, context: number) {
  const index = Math.max(0, pass.findIndex((paragraph) => paragraph.id === activeId));
  const radius = Math.max(0, Math.min(2, context));
  return { index, before: Math.max(0, index - radius), after: Math.max(0, pass.length - index - radius - 1), paragraphs: pass.slice(Math.max(0, index - radius), index + radius + 1) };
}

/** Keep the last block for orientation; the reader can look further ahead. */
export function turboWindows(pass: Paragraph[], activeId: string | undefined, context: number) {
  const index = Math.max(0, pass.findIndex(p => p.id === activeId));
  const ahead = Number.isFinite(context) ? Math.max(0, Math.min(2, Math.trunc(context))) : 1;
  const slice = (forward: number) => {
    const start = Math.max(0, index - 1), end = Math.min(pass.length, index + forward + 1);
    return { index, before: start, after: Math.max(0, pass.length - end), paragraphs: pass.slice(start, end) };
  };
  return { source: slice(ahead), preview: slice(ahead + 2) };
}

/** A fast jump never certifies intervening blocks; backward movement is navigation. */
export function scrollTurbo(turbo: TurboState, pass: Paragraph[], targetId: string, text: string, waiting: boolean): TurboState {
  const from = pass.findIndex(p => p.id === turbo.activeParagraphId), to = pass.findIndex(p => p.id === targetId);
  if (from < 0 || to < 0 || from === to) return turbo;
  const next = turbo.autoCheck && !waiting && to === from + 1 ? checkParagraph(turbo, pass[from].id, text, "scroll") : turbo;
  return { ...next, activeParagraphId: targetId, atEnd: false };
}
