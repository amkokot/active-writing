import { mathParts } from "./mathText.ts";
import { groupAt } from "./references.ts";

export interface ReadingFigureContext {
  projectId: string;
  revision: string;
  files: string[];
}
export interface ReadingFigure {
  path: string;
  url?: string;
  image: boolean;
  width?: string;
}

const raster = /\.(?:png|jpe?g|gif|webp)$/i;
const extensions = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"];

/** Only literal, catalogued project assets. No macro expansion, remote URLs or traversal. */
function figureFile(argument: string, context: ReadingFigureContext): string | undefined {
  const value = argument.trim().replace(/\\([ &_#%])/g, "$1").replace(/^\.\//, "");
  if (!value || value.length > 240 || /[\\:\x00-\x1f\x7f{}]/.test(value) || value.startsWith("/")) return;
  if (value.split("/").some(part => !part || part === "." || part === "..")) return;
  if (context.files.includes(value) && (raster.test(value) || /\.pdf$/i.test(value))) return value;
  if (!/\.[^/]+$/.test(value)) return extensions.map(extension => value + extension).find(file => context.files.includes(file));
}

function figureWidth(options: string): string | undefined {
  const value = options.match(/(?:^|,)\s*width\s*=\s*([^,]+)/)?.[1]?.trim();
  if (!value) return;
  const relative = value.match(/^(\d*\.?\d*)\\(?:line|text|column)width$/);
  if (relative) {
    const fraction = relative[1] ? Number(relative[1]) : 1;
    return fraction > 0 && fraction <= 1 ? `${fraction * 100}%` : undefined;
  }
  return /^(?:\d+\.?\d*|\.\d+)(?:px|pt|cm|mm|in|em)$/.test(value) && parseFloat(value) > 0 ? value : undefined;
}

/** Display-only adaptation. The saved TeX, source anchors and compiler are untouched. */
export function readingFigures(text: string, context?: ReadingFigureContext) {
  const figures = new Map<string, ReadingFigure>();
  if (!context) return { text, figures };
  const protectedParts = mathParts(text, Infinity).filter(part => part.math || part.code);
  const commands = /\\(includegraphics|begin|end|centering|caption)\b(\*)?\s*/g;
  let match: RegExpExecArray | null, cursor = 0, protectedIndex = 0, figureDepth = 0, result = "";
  while ((match = commands.exec(text))) {
    while (protectedParts[protectedIndex]?.end <= match.index) protectedIndex++;
    if (protectedParts[protectedIndex] && match.index >= protectedParts[protectedIndex].start && match.index < protectedParts[protectedIndex].end) continue;
    const line = text.slice(text.lastIndexOf("\n", match.index - 1) + 1, match.index);
    if (/(?<!\\)%/.test(line)) continue;
    let slashes = 0; for (let at = match.index - 1; at >= 0 && text[at] === "\\"; at--) slashes++;
    if (slashes % 2) continue;
    let end = commands.lastIndex, replacement: string | undefined;
    const command = match[1];
    if (command === "begin" || command === "end") {
      const group = groupAt(text, end); if (!group || !/^figure\*?$/.test(group.text)) continue;
      end = group.end;
      if (command === "begin") {
        figureDepth++;
        const optionStart = end + (text.slice(end).match(/^\s*/)?.[0].length ?? 0);
        if (text[optionStart] === "[") { const option = groupAt(text, optionStart, "[", "]"); if (option) end = option.end; }
      } else figureDepth = Math.max(0, figureDepth - 1);
      replacement = "\n\n";
    } else if (command === "centering" && figureDepth) replacement = "";
    else if (command === "includegraphics" || command === "caption" && figureDepth) {
      let options = "";
      if (text[end] === "[") {
        const option = groupAt(text, end, "[", "]"); if (!option) continue;
        options = option.text; end = option.end + (text.slice(option.end).match(/^\s*/)?.[0].length ?? 0);
      }
      const group = groupAt(text, end); if (!group) continue;
      end = group.end;
      if (command === "caption") replacement = `\n\n**Figure.** ${group.text}\n\n`;
      else {
        const path = figureFile(group.text, context), key = `#aw-reading-figure-${figures.size}`;
        figures.set(key, {
          path: path ?? group.text,
          url: path ? `/api/paperfocus/files/content?${new URLSearchParams({ projectId: context.projectId, file: path, revision: context.revision })}` : undefined,
          image: Boolean(path && raster.test(path)), width: figureWidth(options),
        });
        replacement = `\n\n![Project figure](${key})\n\n`;
      }
    }
    if (replacement !== undefined) {
      result += text.slice(cursor, match.index) + replacement;
      cursor = end; commands.lastIndex = end;
    }
  }
  return { text: result + text.slice(cursor), figures };
}
