import type { RewriteCandidate, RewriteRoute, RewriteSession, SelectedPassage } from "./types";
import { thinkingLevels } from "./workspaceTools.ts";

export const routeLabels: Record<RewriteRoute, string> = {
  rules: "Quick suggestions",
  local: "On this computer",
  codex: "Shared folder",
  chatgpt: "Copy to chat",
};

export const effortLabels: Record<RewriteRoute, string[]> = {
  rules: ["Basic", "Full"],
  local: ["Tiny", "Light", "Balanced", "Thorough"],
  codex: thinkingLevels,
  chatgpt: thinkingLevels,
};

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function fingerprint(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeSpacing(text: string) {
  return text.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

function directVersion(text: string) {
  const direct = normalizeSpacing(
    text
      .replace(/It is important to note that\s+/gi, "")
      .replace(/It should be noted that\s+/gi, "")
      .replace(/due to the fact that/gi, "because")
      .replace(/in order to/gi, (match) => /^[A-Z]/.test(match) ? "To" : "to")
      .replace(/without requiring either observation to be treated as ground truth/gi, "without treating either observation as ground truth"),
  );
  return /^[A-Z]/.test(text) && /^[a-z]/.test(direct) ? direct[0].toUpperCase() + direct.slice(1) : direct;
}

function compactVersion(text: string) {
  const compact = directVersion(text)
    .replace(/The fact that\s+/gi, "That ")
    .replace(/a number of/gi, "several")
    .replace(/at this point in time/gi, "now")
    .replace(/is able to/gi, "can");
  if (compact.includes(":")) {
    const [first, ...rest] = compact.split(":");
    const continuation = rest.join(":").trim();
    if (continuation) return `${first.trim()}. ${continuation[0].toUpperCase()}${continuation.slice(1)}`;
  }
  return compact;
}

function emphasisVersion(text: string) {
  const direct = directVersion(text);
  if (/^Their disagreement is informative/i.test(direct)) {
    return direct.replace(
      /^Their disagreement is informative:\s*/i,
      "The disagreement between the measurements is itself informative: ",
    );
  }
  return direct;
}

// Shield source syntax before prose rules run. Be conservative: command
// arguments and brace groups are left untouched, even if they contain prose.
export function shieldLatex(text: string) {
  const saved: Array<{ marker: string; text: string }> = [];
  let safe = "";
  const groupEnd = (start: number, open: string, close: string) => {
    let depth = 0;
    for (let index = start; index < text.length; index++) {
      if (text[index] === "\\") { index++; continue; }
      if (text[index] === "%") { const newline = text.indexOf("\n", index); if (newline < 0) return text.length; index = newline; continue; }
      if (text[index] === open) depth++;
      if (text[index] === close && --depth === 0) return index + 1;
    }
    return text.length;
  };
  for (let cursor = 0; cursor < text.length;) {
    const start = cursor;
    const environment = text.slice(cursor).match(/^\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|split|displaymath|math)\}/);
    if (environment) {
      const close = `\\end{${environment[1]}}`;
      const end = text.indexOf(close, cursor + environment[0].length);
      cursor = end < 0 ? text.length : end + close.length;
    } else if (text[cursor] === "%") {
      const end = text.indexOf("\n", cursor); cursor = end < 0 ? text.length : end + 1;
    } else if (text[cursor] === "$") {
      const delimiter = text[cursor + 1] === "$" ? "$$" : "$";
      cursor += delimiter.length;
      while (cursor < text.length) {
        if (text[cursor] === "\\") { cursor += 2; continue; }
        if (text.startsWith(delimiter, cursor)) { cursor += delimiter.length; break; }
        cursor++;
      }
    } else if (text.startsWith("\\(", cursor) || text.startsWith("\\[", cursor)) {
      const close = text[cursor + 1] === "(" ? "\\)" : "\\]";
      const end = text.indexOf(close, cursor + 2); cursor = end < 0 ? text.length : end + 2;
    } else if (text[cursor] === "{") {
      cursor = groupEnd(cursor, "{", "}");
    } else if (text[cursor] === "\\") {
      const command = text.slice(cursor).match(/^\\(?:[a-zA-Z@]+\*?|.)/s);
      cursor += command?.[0].length ?? 1;
      while (cursor < text.length) {
        const gap = text.slice(cursor).match(/^[ \t]*/)?.[0].length ?? 0;
        const next = cursor + gap;
        if (text[next] === "{") cursor = groupEnd(next, "{", "}");
        else if (text[next] === "[") cursor = groupEnd(next, "[", "]");
        else break;
      }
    } else { safe += text[cursor++]; continue; }
    // A deterministic marker containing no ordinary words; restore exactly.
    let marker = `ZZPFPROTECTED${saved.length}ZZ`;
    while (text.includes(marker)) marker = `Z${marker}`;
    saved.push({ marker, text: text.slice(start, cursor) });
    safe += marker;
  }
  return { safe, markers: saved.map((item) => item.marker), protectedParts: saved.map((item) => item.text), restore: (candidate: string) => {
    let result = candidate;
    saved.forEach((item) => { result = result.replace(new RegExp(item.marker, "gi"), () => item.text); });
    return result;
  } };
}

export function sameProtectedLatex(before: string, after: string) {
  const original = shieldLatex(before).protectedParts;
  const replacement = shieldLatex(after).protectedParts;
  return original.length === replacement.length && original.every((part, index) => part === replacement[index]);
}

export function generateRuleCandidates(text: string): RewriteCandidate[] {
  const protectedText = shieldLatex(text);
  const versions = [
    { text: protectedText.restore(directVersion(protectedText.safe)), source: "Rule · direct" },
    { text: protectedText.restore(compactVersion(protectedText.safe)), source: "Rule · compact" },
    { text: protectedText.restore(emphasisVersion(protectedText.safe)), source: "Rule · emphasis" },
  ];
  const seen = new Set<string>();
  return versions
    .filter((item) => {
      const key = item.text.toLocaleLowerCase();
      if (!item.text || normalizeSpacing(item.text) === normalizeSpacing(text) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({ id: uid("candidate"), dismissed: false, userEdited: false, ...item }));
}

export function generateSelectionCandidates(spans: SelectedPassage[]): RewriteCandidate[] {
  const candidates = spans.map(span => generateRuleCandidates(span.text));
  const original = spans.map(span => span.text).join("\n\n");
  const values = [0, 1, 2].map(index => ({ id: uid("candidate"), text: spans.map((span, i) => candidates[i][index]?.text ?? span.text).join("\n\n"), source: "Quick · selected blocks", dismissed: false, userEdited: false }));
  return values.filter((c, i) => c.text !== original && values.findIndex(other => other.text === c.text) === i);
}

export function createRewriteSession(input: {
  paragraphId: string;
  nodeId: string;
  start: number;
  end: number;
  text: string;
  paragraphText: string;
  spans?: SelectedPassage[];
}): RewriteSession {
  const now = new Date().toISOString();
  return {
    id: uid("rewrite"),
    paragraphId: input.paragraphId,
    nodeId: input.nodeId,
    start: input.start,
    end: input.end,
    sourceText: input.text,
    ...(input.spans ? { selectionSpans: input.spans } : {}),
    sourceFingerprint: fingerprint(input.text),
    beforeAnchor: input.paragraphText.slice(Math.max(0, input.start - 36), input.start),
    afterAnchor: input.paragraphText.slice(input.end, input.end + 36),
    instruction: input.spans ? `Make these ${input.spans.length} blocks clearer without changing the claims. Return exactly ${input.spans.length} blocks in the same order, separated by blank lines. Keep all math, commands, labels and comments in their original block.` : "Make this clearer without changing the claim",
    route: "rules",
    effortByRoute: { rules: 1, local: 1, codex: 1, chatgpt: 1 },
    candidates: input.spans ? generateSelectionCandidates(input.spans) : generateRuleCandidates(input.text),
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}
