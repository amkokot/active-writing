import { mathParts } from "./mathText.ts";

export interface ReplySection {
  title: string;
  level: number;
  start: number;
  text: string;
  /** Exact original text, including its heading and whitespace. */
  source: string;
  reviewCue: boolean;
}

/** A bounded display outline, not a model summary, Markdown executor or correctness classifier. */
export function replyOutline(text: string): { intro: string; sections: ReplySection[] } {
  // Oversized answers remain intact in the ordinary reader rather than being silently shortened.
  if (text.length > 100_000) return { intro: text, sections: [] };
  const protectedParts = mathParts(text, Infinity).filter((part) => part.math || part.code);
  const headings: Array<{ title: string; level: number; start: number; body: number }> = [];
  let position = 0, protectedIndex = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const content = line.replace(/\r?\n$/, "");
    // Both lists are in source order: advance once rather than scanning every
    // equation/code block again for every line in a long reply.
    while (protectedIndex < protectedParts.length && protectedParts[protectedIndex].end <= position) protectedIndex++;
    const part = protectedParts[protectedIndex];
    const protectedLine = part && position >= part.start && position < part.end;
    if (!protectedLine && headings.length < 64) {
      const heading = content.match(/^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/);
      if (heading) headings.push({ title: heading[2].replace(/[\t ]+#+[\t ]*$/, ""), level: heading[1].length, start: position, body: position + line.length });
    }
    position += line.length;
  }
  if (!headings.length) return { intro: text, sections: [] };
  return {
    intro: text.slice(0, headings[0].start),
    sections: headings.map((heading, index) => {
      const end = headings[index + 1]?.start ?? text.length;
      return { ...heading, text: text.slice(heading.body, end), source: text.slice(heading.start, end),
        // These headings stay open in compact view. Their content is still unverified.
        reviewCue: /\b(?:checks?|uncertaint(?:y|ies)|gaps?|limitations?|warnings?|caveats?|missing|unresolved|open|incomplete|remaining|obligations?|provenance)\b|\bnot\s+(?:proved|proven|recovered|verified)\b/i.test(heading.title) };
    }),
  };
}
