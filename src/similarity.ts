import type { Paragraph, ThemeMatch } from "./types";

const stopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "been", "both", "by",
  "can", "for", "from", "has", "have", "in", "into", "is", "it", "its", "may",
  "must", "no", "not", "of", "on", "or", "our", "so", "such", "than", "that",
  "the", "their", "then", "there", "these", "this", "those", "to", "under", "was",
  "we", "when", "where", "which", "with", "without",
]);

function stem(token: string) {
  return token
    .replace(/(ization|ational|fulness|iveness)$/u, "")
    .replace(/(ments|ment|ing|ies|ied|ed|es|s)$/u, "")
    .replace(/(.)\1+$/u, "$1");
}

function tokens(text: string) {
  const words = (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(stem)
    .filter((token) => token.length > 2 && !stopWords.has(token));
  const bigrams = words.slice(1).map((word, index) => `${words[index]}·${word}`);
  return [...words, ...bigrams];
}

function counts(items: string[]) {
  const result = new Map<string, number>();
  items.forEach((item) => result.set(item, (result.get(item) ?? 0) + 1));
  return result;
}

function cosine(left: Map<string, number>, right: Map<string, number>, idf: Map<string, number>) {
  const terms = new Set([...left.keys(), ...right.keys()]);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  terms.forEach((term) => {
    const weight = idf.get(term) ?? 1;
    const a = (left.get(term) ?? 0) * weight;
    const b = (right.get(term) ?? 0) * weight;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  });
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function rankRelevantParagraphs(
  seedText: string,
  paragraphs: Paragraph[],
  paragraphEdits: Record<string, string>,
  seedParagraphId: string,
  limit = 7,
): ThemeMatch[] {
  const documents = paragraphs.map((paragraph) =>
    tokens(paragraphEdits[paragraph.id] ?? paragraph.text),
  );
  const documentFrequency = new Map<string, number>();
  documents.forEach((document) => {
    new Set(document).forEach((term) =>
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1),
    );
  });
  const idf = new Map<string, number>();
  documentFrequency.forEach((frequency, term) =>
    idf.set(term, Math.log((documents.length + 1) / (frequency + 1)) + 1),
  );
  const seed = counts(tokens(seedText));
  const ranked = paragraphs
    .map((paragraph, index) => ({
      paragraphId: paragraph.id,
      score: paragraph.id === seedParagraphId ? 1 : cosine(seed, counts(documents[index]), idf),
      pinned: paragraph.id === seedParagraphId,
    }))
    .filter((match) => match.paragraphId === seedParagraphId || match.score > 0.035)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  if (!ranked.some((match) => match.paragraphId === seedParagraphId)) {
    ranked.unshift({ paragraphId: seedParagraphId, score: 1, pinned: true });
  }
  return ranked;
}

export function themeNameFromSelection(text: string) {
  const keywords = tokens(text).filter((token) => !token.includes("·")).slice(0, 4);
  const name = [...new Set(keywords)].join(" ");
  return name
    ? name.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
    : "Untitled theme";
}
