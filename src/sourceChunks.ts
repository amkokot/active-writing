/** Visual chunks retain every character and use ordinary LaTeX blank lines. */
export interface SourceChunk { text: string; start: number; end: number; separator: string }
export type ChunkAction = "focus" | "ask" | "rewrite" | "comment" | "later";
export interface ParagraphJoinUndo {
  projectId: string; mainFile: string; revision: string; paragraphId: string;
  text: string; start: number; end: number; separator: string;
}
export function hasTrailingLineBreak(text: string) { return /\r?\n[\t ]*$/.test(text); }
const mathEnvironment = /^(?:equation|align|alignat|gather|multline|eqnarray|flalign|aligned|alignedat|gathered|split|displaymath|math|cases|matrix|[pbBvV]matrix|smallmatrix|array)\*?$/;

/** Literal lexical boundaries, including unfinished syntax. Never evaluates TeX. */
export function sourceBoundaries(text: string, enclosingEnvironment = false) {
  const separators: Array<{ start: number; end: number }> = [], opaque: Array<{ start: number; end: number }> = [];
  const environments: Array<{ name: string; start: number }> = [];
  let at = 0, math = "", mathStart = 0, braces = 0, braceStart = 0;
  while (at < text.length) {
    const verbatim = environments.at(-1);
    if (verbatim && /^(?:verbatim\*?|Verbatim|lstlisting|minted)$/.test(verbatim.name)) {
      const close = text.slice(at).match(/^\\end\s*\{([^}]+)\}/);
      if (close?.[1] === verbatim.name) { environments.pop(); opaque.push({ start: verbatim.start, end: at + close[0].length }); at += close[0].length; }
      else at++;
      continue;
    }
    if (text[at] === "%") { const newline = text.indexOf("\n", at); at = newline < 0 ? text.length : newline; continue; }
    if (!math && !braces && !environments.length && !enclosingEnvironment && (text[at] === "\n" || text[at] === "\r")) {
      const blank = text.slice(at).match(/^\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/);
      if (blank) { separators.push({ start: at, end: at + blank[0].length }); at += blank[0].length; continue; }
    }
    if (text[at] === "\\") {
      const verb = !math && text.slice(at).match(/^\\verb\*?([^a-zA-Z\s])/);
      if (verb) {
        const end = text.indexOf(verb[1], at + verb[0].length);
        const next = end < 0 ? text.length : end + 1;
        opaque.push({ start: at, end: next }); at = next; continue;
      }
      const environment = text.slice(at).match(/^\\(begin|end)\s*\{([\w*:-]+)\}/);
      if (environment && !math && !braces) {
        if (environment[1] === "begin") environments.push({ name: environment[2], start: at });
        else if (environments.at(-1)?.name === environment[2]) {
          const opened = environments.pop()!;
          if (mathEnvironment.test(opened.name)) opaque.push({ start: opened.start, end: at + environment[0].length });
        }
        at += environment[0].length; continue;
      }
      const delimiter = text.slice(at, at + 2);
      if (!math && ["\\(", "\\["].includes(delimiter)) { math = delimiter === "\\(" ? "\\)" : "\\]"; mathStart = at; at += 2; continue; }
      if (math && delimiter === math) { opaque.push({ start: mathStart, end: at + 2 }); math = ""; at += 2; continue; }
      at += 2; continue;
    }
    if (text[at] === "$") {
      const delimiter = text[at + 1] === "$" ? "$$" : "$";
      if (!math) { math = delimiter; mathStart = at; }
      else if (math === delimiter) { opaque.push({ start: mathStart, end: at + delimiter.length }); math = ""; }
      at += delimiter.length; continue;
    }
    if (!math && text[at] === "{") { if (!braces) braceStart = at; braces++; }
    else if (!math && text[at] === "}" && braces && --braces === 0) opaque.push({ start: braceStart, end: at + 1 });
    at++;
  }
  if (math) opaque.push({ start: mathStart, end: text.length });
  if (braces) opaque.push({ start: braceStart, end: text.length });
  for (const environment of environments) if (mathEnvironment.test(environment.name) || /^(?:verbatim\*?|Verbatim|lstlisting|minted)$/.test(environment.name)) opaque.push({ start: environment.start, end: text.length });
  return { separators, opaque };
}

export function sourceChunks(text: string, enclosingEnvironment = false): SourceChunk[] {
  const chunks: SourceChunk[] = []; let start = 0;
  for (const boundary of sourceBoundaries(text, enclosingEnvironment).separators) {
    chunks.push({ text: text.slice(start, boundary.start), start, end: boundary.start, separator: text.slice(boundary.start, boundary.end) }); start = boundary.end;
  }
  chunks.push({ text: text.slice(start), start, end: text.length, separator: "" }); return chunks;
}

/** Backspace at a nonempty visual chunk's start removes its paragraph boundary. */
export function joinChunkAtStart(text: string, offset: number, enclosingEnvironment = false) {
  const chunks = sourceChunks(text, enclosingEnvironment), index = chunks.findIndex(chunk => chunk.start === offset);
  if (index <= 0 || !chunks[index].text.trim()) return;
  const previous = chunks[index - 1], gap = /(?<!\\)%[^\r\n]*$/.test(previous.text) ? "\n" : " ";
  return { text: text.slice(0, previous.end) + gap + text.slice(offset), caret: previous.end + gap.length };
}
export function chunkAtOffset(chunks: SourceChunk[], offset: number) {
  return chunks.find(chunk => offset >= chunk.start && offset <= chunk.end) ?? chunks.find(chunk => offset < chunk.start) ?? chunks.at(-1)!;
}
/** Remove a context-free empty visual block, not any neighboring prose. */
export function removeEmptyChunk(text: string, offset: number, enclosingEnvironment = false) {
  const chunks = sourceChunks(text, enclosingEnvironment), chunk = chunkAtOffset(chunks, offset), index = chunks.indexOf(chunk);
  // Chromium may leave the caret in the blank-line text node immediately
  // before an empty span. That position still belongs to the empty block.
  const gapStart = index > 0 ? chunks[index - 1].end : chunk.start;
  if (chunks.length < 2 || chunk.text.trim() || offset < 0 || (offset <= gapStart && index > 0) || offset > chunk.end) return undefined;
  const from = index > 0 ? chunks[index - 1].end : 0;
  const to = index > 0 ? chunk.end : chunk.end + chunk.separator.length;
  return { text: text.slice(0, from) + text.slice(to), caret: from, start: chunk.start, end: chunk.end };
}
