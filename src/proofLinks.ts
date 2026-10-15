import type { DocumentLabel, ManuscriptNode } from "./types.ts";
import { referenceTokens } from "./references.ts";

export function explicitProofHeading(title?: string) {
  if (!title) return false;
  if (referenceTokens(title).some(token => token.kind === "label")) return true;
  // An adjacent "Proof of the claim" still belongs to that preceding claim;
  // it isn't a remote result identifier.
  if (/^\s*proof\s+(?:of|for)\s+(?:the|this|above|previous)\s+(?:claim|result|statement|theorem|lemma|corollary|proposition)\s*[.:]?\s*$/i.test(title)) return false;
  return /\bproofs?\s+(?:of|for)\b/i.test(title);
}

export function linkedProofTitle(proof: ManuscriptNode, nodes: ManuscriptNode[]) {
  const titles = proof.proofFor?.flatMap(id => {
    const node = nodes.find(item => item.id === id);
    return node ? [node.title.split(" · ")[0]] : [];
  });
  return titles?.length ? `Proof of ${titles.join(" and ")}` : proof.title;
}

/** Resolve only explicit headings. Body references do not identify what is
 * being proved. Unknown/duplicate labels and ambiguous names never get guessed. */
export function attachProofLinks(nodes: ManuscriptNode[], labels: DocumentLabel[]) {
  const statements = nodes.filter(node => ["theorem", "lemma", "corollary"].includes(node.kind));
  const statementIds = new Set(statements.map(node => node.id));
  const name = (value: string) => value.replace(/~/g, " ").replace(/\s+/g, " ").trim().replace(/[.:]$/, "").toLowerCase();
  for (const proof of nodes.filter(node => node.kind === "proof")) {
    const title = proof.environmentTitle ?? "";
    const tokens = referenceTokens(title).filter(token => token.kind === "label");
    const targets = new Set<string>();
    for (const key of tokens.flatMap(token => token.keys)) {
      const matches = labels.filter(label => label.key === key);
      if (matches.length === 1 && statementIds.has(matches[0].nodeId)) targets.add(matches[0].nodeId);
    }
    if (!tokens.length) {
      const named = title.match(/^\s*proofs?\s+(?:of|for)\s+(?:the\s+)?(.+?)\s*$/i)?.[1];
      const matches = named ? statements.filter(node => name(node.title.split(" · ")[0]) === name(named)) : [];
      if (matches.length === 1) targets.add(matches[0].id);
    }
    proof.proofFor = targets.size ? [...targets] : undefined;
  }
}
