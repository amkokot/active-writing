export interface PaperAppearance {
  family: "modern" | "times" | "palatino" | "sans" | "unknown";
  sizePt: number;
  columns: 1 | 2;
  description: string;
}

/** Literal hints for the source editor, not a TeX interpreter or layout promise. */
export function paperAppearance(preamble: string): PaperAppearance {
  const source = preamble.replace(/(?<!\\)%[^\r\n]*/g, "");
  const declaration = source.match(/\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}/);
  const sizePt = Number(declaration?.[1]?.match(/\b(10|11|12)pt\b/)?.[1] ?? 10);
  const packages = [...source.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)].flatMap(m => m[1].split(",").map(p => p.trim()));
  let family: PaperAppearance["family"] = /^(?:article|report|book|amsart|amsbook)$/.test(declaration?.[2] ?? "") ? "modern" : "unknown";
  let columns: 1 | 2 = /\btwocolumn\b/.test(declaration?.[1] ?? "") ? 2 : 1;
  for (const name of packages) {
    if (/^(?:times|mathptmx|newtxtext|txfonts|neurips_\d{4}|icml\d{4})$/.test(name)) family = "times";
    else if (/^(?:mathpazo|newpxtext|palatino)$/.test(name)) family = "palatino";
    else if (/^(?:lmodern|cmbright)$/.test(name)) family = name === "cmbright" ? "sans" : "modern";
    else if (name === "fontspec") family = "unknown";
    if (/^icml\d{4}$/.test(name)) columns = 2;
  }
  // Unsupported font selection must not be advertised as a match.
  if (/\\(?:setmainfont|renewcommand\*?\s*\{\\rmdefault\})/.test(source)) family = "unknown";
  const names = { modern: "Computer Modern-like serif", times: "Times-like serif", palatino: "Palatino-like serif", sans: "Sans serif", unknown: "Paper font not detected" };
  return { family, sizePt, columns, description: `${names[family]} · ${sizePt} pt${columns === 2 ? " · two-column paper" : ""}` };
}

export function editorFont(family?: PaperAppearance["family"]) {
  return ({ modern: '"Active Writing Modern", "Times New Roman", serif', times: '"Times New Roman", Times, serif', palatino: '"Palatino Linotype", "Book Antiqua", serif', sans: 'Arial, sans-serif', unknown: '"Times New Roman", serif' })[family ?? "unknown"];
}
