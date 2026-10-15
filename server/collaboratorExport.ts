import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { notebookForManuscript } from "../src/manuscripts.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReplyMarkdown } from "../src/replyMarkdown.ts";
import { cellText, mimeText, outputText, experimentStaleness, experimentPlot, type ExperimentStore, type ExperimentCell } from "../src/experiments.ts";
import { experimentHeatmap, heatmapMime, heatmapFraction, heatmapRange } from "../src/experimentHeatmap.ts";
import { experimentSweep, sweepMime } from "../src/experimentSweep.ts";
import { orderedNotebookEntries } from "../src/notebookCatalogue.ts";
import { locateSavedPassage } from "../src/sourceRefresh.ts";
import { mathParts } from "../src/mathText.ts";
import { readingFigures } from "../src/readingFigures.ts";
import type { ProjectDocument, NotebookEntry } from "../src/types.ts";
import { parseProject, getProject, projectFiles, projectRevision } from "./projects.ts";
import { readNotebook } from "./notebookStore.ts";
import { readExperiments } from "./experiments.ts";
import { sourceEntries, zipEntries } from "./sourceZip.ts";
import { projectFileContent } from "./projectFiles.ts";
import { renderSharingPdf, sharingPdfHtml } from "./sharingPdf.ts";
import { compactReaderFiles, overviewBody, portableReaderLinks, portableReadingMarkdown, repositoryLink } from "./readerPages.ts";

type File = { name: string; data: Buffer };
const e = (text: unknown) => String(text ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const pre = (text: string) => `<pre>${e(text)}</pre>`;
const md = (text: string) => renderToStaticMarkup(createElement(ReplyMarkdown, { text }));
const fence = (text: string, language = "") => { const marks = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1))); return `${marks}${language}\n${text}\n${marks}`; };
function uncomment(text: string) {
  // A reading copy is not a source-code dump. Verbatim/listing blocks retain
  // literal percent characters; ordinary TeX comments are not reader material.
  if (/\\begin\{(?:verbatim\*?|lstlisting|minted)\}|\\verb\*?[^a-zA-Z\s]/.test(text)) return text;
  return text.split("\n").map(line => {
    for (let at = 0; at < line.length; at++) if (line[at] === "%") {
      let slashes = 0; for (let before = at - 1; before >= 0 && line[before] === "\\"; before--) slashes++;
      if (slashes % 2 === 0) return line.slice(0, at);
    }
    return line;
  }).join("\n");
}
function readingText(text: string) {
  text = uncomment(text);
  return mathParts(text, Infinity).map(part => part.math || part.code ? text.slice(part.start, part.end) : part.text
    .replace(/\\(?:textbf)\{([^{}]*)\}/g, "**$1**").replace(/\\(?:emph|textit)\{([^{}]*)\}/g, "*$1*")
    .replace(/\\label\{[^{}]*\}/g, "").replace(/\\([%&_#])/g, "$1").replace(/~/g, " ")).join("");
}
const palette = ["#2563a6", "#b06d25", "#38815c", "#775bb1", "#ac4f54", "#357f8b", "#625744", "#686f79"];
function plotFigure(value: unknown) {
  const plot = experimentPlot(value); if (!plot) return "";
  const xs = plot.series.flatMap(series => series.points.map(point => plot.xScale === "log" ? Math.log10(point[0]) : point[0]));
  const ys = plot.series.flatMap(series => series.points.map(point => plot.yScale === "log" ? Math.log10(point[1]) : point[1]));
  if (!xs.length) return "";
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  xs.forEach(n => { xmin = Math.min(xmin, n); xmax = Math.max(xmax, n); }); ys.forEach(n => { ymin = Math.min(ymin, n); ymax = Math.max(ymax, n); });
  const scaled = (n: number, min: number, max: number) => min === max ? 0.5 : (n / 2 - min / 2) / (max / 2 - min / 2);
  const lines = plot.series.map((series, index) => `<polyline fill="none" stroke="${palette[index]}" stroke-width="2" points="${series.points.map(([x, y]) => `${(60 + scaled(plot.xScale === "log" ? Math.log10(x) : x, xmin, xmax) * 620).toFixed(3)},${(280 - scaled(plot.yScale === "log" ? Math.log10(y) : y, ymin, ymax) * 235).toFixed(3)}`).join(" ")}"/>`).join("");
  const values = `<div class="table-scroll"><table><thead><tr><th>Series</th><th>${e(plot.xLabel)} · original values</th><th>${e(plot.yLabel)} · original values</th></tr></thead><tbody>${plot.series.flatMap(series => series.points.map(([x, y]) => `<tr><td>${e(series.name)}</td><td>${x}</td><td>${y}</td></tr>`)).join("")}</tbody></table></div>`;
  return `<figure><figcaption>${e(plot.title)}</figcaption><svg viewBox="0 0 720 330" role="img" aria-label="${e(plot.title)}"><path d="M60 40V280H690" fill="none" stroke="#999"/>${lines}<text x="370" y="320" text-anchor="middle">${e(plot.xLabel)}${plot.xScale === "log" ? " (log)" : ""}</text><text x="12" y="160" transform="rotate(-90 12 160)" text-anchor="middle">${e(plot.yLabel)}${plot.yScale === "log" ? " (log)" : ""}</text><text x="60" y="300">${e(plot.xScale === "log" ? 10 ** xmin : xmin)}</text><text x="680" y="300" text-anchor="end">${e(plot.xScale === "log" ? 10 ** xmax : xmax)}</text><text x="55" y="45" text-anchor="end">${e(plot.yScale === "log" ? 10 ** ymax : ymax)}</text><text x="55" y="280" text-anchor="end">${e(plot.yScale === "log" ? 10 ** ymin : ymin)}</text></svg><p class="legend">${plot.series.map((series, i) => `<span style="color:${palette[i]}">${e(series.name)}</span>`).join(" · ")}</p><details><summary>Complete saved values</summary>${values}</details></figure>`;
}
function outputDisplay(output: ExperimentCell["outputs"] extends Array<infer T> | undefined ? T : never, prefix: string, files: File[]) {
  const data = output.data ?? {}, pieces: string[] = [];
  const png = mimeText(data["image/png"]);
  if (png) {
    const bytes = Buffer.from(png.replace(/\s/g, ""), "base64");
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("A saved figure is not a valid PNG; export stopped.");
    const name = `figures/${prefix}.png`; files.push({ name, data: bytes }); pieces.push(`<figure><img src="data:image/png;base64,${bytes.toString("base64")}" alt="Saved experiment figure" loading="lazy"/></figure>`);
  }
  const plot = plotFigure(data["application/vnd.paperfocus.plot+json"]); if (plot) pieces.push(plot);
  const heatmap = experimentHeatmap(data[heatmapMime]);
  if (heatmap) {
    const { min, max } = heatmapRange(heatmap);
    pieces.push(`<figure><figcaption>${e(heatmap.title)} · saved samples, no interpolation</figcaption><div class="table-scroll"><table><thead><tr><th>${e(heatmap.yLabel)} / ${e(heatmap.xLabel)}</th>${heatmap.x.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${heatmap.values.map((row, j) => `<tr><th>${heatmap.y[j]}</th>${row.map(value => `<td style="background:hsl(210 45% ${96 - heatmapFraction(value, min, max, heatmap.colorScale) * 35}%)">${value}</td>`).join("")}</tr>`).join("")}</tbody></table></div></figure>`);
  }
  const sweep = experimentSweep(data[sweepMime]);
  if (sweep) pieces.push(`<figure><figcaption>${e(sweep.title)} · ${sweep.frames.length} saved frames</figcaption>${sweep.frames.map((frame, i) => `<details${i === (sweep.initial ?? 0) ? " open" : ""}><summary>${e(sweep.parameter)} = ${frame.value}</summary>${plotFigure(frame.plot)}</details>`).join("")}</figure>`);
  const markdown = mimeText(data["text/markdown"]); if (markdown) pieces.push(md(markdown));
  const text = outputText(output); if (text) pieces.push(pre(text));
  if (data["application/json"] !== undefined) pieces.push(`<details><summary>Saved data</summary>${pre(JSON.stringify(data["application/json"], null, 2))}</details>`);
  if (Object.keys(data).some(key => !safeMime(key))) pieces.push('<p class="muted">Executable or unsupported rich output omitted from this sharing copy.</p>');
  return pieces.join("") || '<p class="muted">No portable saved output.</p>';
}
function safeMime(mime: string) { return ["text/plain", "text/markdown", "image/png", "application/json", "application/vnd.paperfocus.plot+json", heatmapMime, sweepMime].includes(mime); }
function sharedCell(cell: ExperimentCell) {
  const info = cell.metadata.paperfocus;
  // Runtime paths identify the author's machine, not portable evidence. Keep
  // execution order/budget, but never export its executable/package locations.
  const execution = info?.execution ? { mode: info.execution.mode, timeoutMs: info.execution.timeoutMs, transport: info.execution.transport, sessionId: info.execution.sessionId, sequence: info.execution.sequence, priorRuns: info.execution.priorRuns } : undefined;
  return { id: cell.id, cell_type: cell.cell_type, source: cell.source, ...(cell.cell_type === "code" ? { execution_count: cell.execution_count } : {}), metadata: { paperfocus: info ? { title: info.title, pinned: info.pinned, highlighted: info.highlighted, folder: info.folder, lastRunAt: info.lastRunAt, lastRunSource: info.lastRunSource, runId: info.runId, execution } : {} },
    ...(cell.outputs ? { outputs: cell.outputs.map(output => ({ output_type: output.output_type, name: output.name, text: output.text, ename: output.ename, evalue: output.evalue, traceback: output.traceback, metadata: {}, ...(output.data ? { data: Object.fromEntries(Object.entries(output.data).filter(([mime]) => safeMime(mime))) } : {}) })) } : {}) };
}

export function collaborationPages(document: ProjectDocument, entries: NotebookEntry[], stores: Map<string, ExperimentStore>, includeFiled: boolean, createdAt: string, manuscriptFigures = new Map<string, string>()) {
  const files: File[] = [], notebookHtml: string[] = [], notebookMarkdown: string[] = [];
  const paragraphAnchors = new Map(document.paragraphs.map((p, i) => [p.id, `passage-${i}`]));
  const passageLinks = new Map<string, string[]>();
  for (const [index, entry] of entries.entries()) {
    if (entry.source?.rootFile && entry.source.rootFile !== document.project.mainFile) continue;
    for (const source of [entry.source, ...(entry.source?.passages ?? [])]) {
      const p = source && locateSavedPassage(source, document, {}); if (!p) continue;
      const link = `<a href="#conversation-${index + 1}">Notebook: ${e(entry.title)}</a>`;
      const links = passageLinks.get(p.id) ?? []; if (!links.includes(link)) links.push(link); passageLinks.set(p.id, links);
    }
  }
  const manuscriptHtml: string[] = [], manuscriptMarkdown: string[] = [];
  // Returning from a theorem/proof resumes its enclosing section. A change in
  // paragraph owner is not a new section: emit each structural node only once.
  const shownNodes = new Set<string>();
  for (const p of document.paragraphs) {
    if (!shownNodes.has(p.nodeId)) {
      shownNodes.add(p.nodeId); const node = document.nodes.find(node => node.id === p.nodeId);
      if (node) { const level = Math.min(5, Math.max(2, node.depth + 1)); const title = `${node.number ? `${node.number} · ` : ""}${node.title}`;
        manuscriptHtml.push(`<h${level}>${e(title)}</h${level}>`); manuscriptMarkdown.push(`${"#".repeat(level)} ${title}`); }
    }
    const links = passageLinks.get(p.id) ?? [];
    const figures = [...uncomment(p.text).matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^{}]+)\}/g)].map(match => manuscriptFigures.get(`${p.file ?? document.project.mainFile}:${match[1]}`)).filter(Boolean);
    const visualText = figures.length ? readingFigures(uncomment(p.text), { projectId: document.project.id, revision: document.revision, files: document.files }).text.replace(/!\[Project figure\]\(#aw-reading-figure-\d+\)/g, "") : p.text;
    manuscriptHtml.push(`<div id="${paragraphAnchors.get(p.id)}" class="passage">${md(readingText(visualText))}${figures.map(src => `<figure><img src="${src}" alt="Manuscript figure" loading="lazy"/></figure>`).join("")}${links.length ? `<p class="muted">${links.join(" · ")}</p>` : ""}</div>`);
    manuscriptMarkdown.push(readingText(p.text));
  }
  let omittedCells = 0;
  for (const [index, entry] of entries.entries()) {
    const number = index + 1, owner = entry.experimentNotebookId ?? entry.id, store = stores.get(owner);
    const html: string[] = [], markdown: string[] = [`## ${number}. ${entry.title}`, `Status: ${entry.status === "integrated" ? "Integrated (author-marked)" : entry.status === "parked" ? "Parked" : "Open"}. Updated: ${entry.updatedAt}.`];
    const source = locateSavedPassage(entry.source, document, {});
    if (source && (!entry.source?.rootFile || entry.source.rootFile === document.project.mainFile)) html.push(`<a href="#${paragraphAnchors.get(source.id)}">Linked manuscript passage</a>`);
    else if (entry.source) html.push('<p class="muted">Captured passage below; its current location is unconfirmed or belongs to another manuscript.</p>');
    for (const [title, text] of [["Captured passage", entry.source?.passages?.map(p => p.excerpt).join("\n\n") ?? entry.source?.excerpt], ["Question", entry.question], ["Notes", entry.notes], ["Reply", entry.reply], ["Proposed change · not automatically applied", entry.proposal]]) if (text?.trim()) { const readable = title === "Captured passage" ? readingText(text) : text; html.push(`<h4>${e(title)}</h4>${md(readable)}`); markdown.push(`### ${title}\n\n${readable}`); }
    for (const [turnIndex, turn] of (entry.study?.turns ?? []).entries()) {
      const answer = turn.reply || (turn.answer ? Object.entries(turn.answer).map(([key, value]) => `### ${key}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`).join("\n\n") : turn.error || "No reply saved.");
      html.push(`<details><summary>Discussion ${turnIndex + 1} · ${e(turn.action)} · ${e(turn.status)}${turn.completedExternally ? " · completed outside Aw" : ""}</summary>${turn.focus ? md(turn.focus.text) : ""}${md(answer)}</details>`);
      markdown.push(`### Discussion ${turnIndex + 1} · ${turn.action} · ${turn.status}\n\n${turn.focus?.text ?? ""}\n\n${answer}`);
    }
    if (store) {
      const cells = store.notebook.cells.filter(cell => !cell.metadata.paperfocus?.deleted && (includeFiled || !cell.metadata.paperfocus?.filed && !cell.metadata.paperfocus?.suppressed));
      omittedCells += store.notebook.cells.length - cells.length;
      const notebookName = `notebooks/conversation-${number}.ipynb`;
      const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" }, language_info: { name: "python" }, active_writing_export: { revision: store.revision, createdAt, instructions: "Saved evidence only. Review code before executing. Aw display helpers may be required. Numerical findings are not proof." } }, cells: cells.map(sharedCell) };
      if (cells.length) { files.push({ name: notebookName, data: Buffer.from(JSON.stringify(notebook, null, 2)) }); html.push(`<p><a href="${notebookName}" download>Jupyter notebook · ${cells.length} cells</a></p>`); }
      for (const [cellIndex, cell] of cells.entries()) {
        const info = cell.metadata.paperfocus, stale = experimentStaleness(cell, store.notebook);
        const status = cell.cell_type !== "code" ? "Research note" : stale ? `Stale output: ${stale}` : cell.outputs?.some(output => output.output_type === "error") ? "Failed run" : info?.runId ? "Saved run · not mathematical verification" : "Unrun or imported output · not independently verified";
        html.push(`<section id="cell-${number}-${e(cell.id)}" class="cell"><h4>${info?.pinned ? "Pinned · " : ""}${e(info?.title || `Cell ${cellIndex + 1}`)}</h4><p class="${stale ? "warning" : "muted"}">${e(status)}${info?.lastRunAt ? ` · ${e(info.lastRunAt)}` : ""}</p>${cell.cell_type === "code" ? `<details><summary>Code${info?.execution?.mode === "session" ? " · shared-session history in notebook" : ""}</summary>${pre(cellText(cell))}</details>` : cell.cell_type === "raw" ? pre(cellText(cell)) : md(cellText(cell))}${(cell.outputs ?? []).map((output, outputIndex) => `<div id="output-${number}-${e(cell.id)}-${outputIndex}" class="output">${outputDisplay(output, `${number}-${cellIndex + 1}-${outputIndex + 1}`, files)}</div>`).join("")}</section>`);
        markdown.push(`### ${info?.title || `Cell ${cellIndex + 1}`}\n\n${status}\n\n${cell.cell_type === "markdown" ? cellText(cell) : fence(cellText(cell), cell.cell_type === "code" ? "python" : "text")}`);
        for (const [outputIndex, output] of (cell.outputs ?? []).entries()) {
          const data = output.data ?? {};
          markdown.push(`#### Saved output ${outputIndex + 1}\n\n${mimeText(data["text/markdown"]) ?? ""}\n\n${fence(outputText(output))}`);
          if (data["image/png"]) markdown.push(`![Saved figure](figures/${number}-${cellIndex + 1}-${outputIndex + 1}.png)`);
          for (const [mime, value] of Object.entries(data)) if (safeMime(mime) && !["image/png", "text/plain", "text/markdown"].includes(mime)) markdown.push(`${mime}\n\n${fence(JSON.stringify(value, null, 2), "json")}`);
        }
      }
    }
    notebookHtml.push(`<article id="conversation-${number}" class="conversation"><h3>${number}. ${e(entry.title)}</h3><p class="muted">${e(entry.status)} · ${e(entry.updatedAt)}</p><details${index === 0 || entry.pinned ? " open" : ""}><summary>Read notes, replies & experiments</summary>${html.join("")}</details></article>`);
    notebookMarkdown.push(markdown.join("\n\n"));
  }
  const contents = document.nodes.filter(node => ["section", "subsection"].includes(node.kind)).flatMap(node => { const first = document.paragraphs.find(p => p.nodeId === node.id); return first ? [`<li><a href="#${paragraphAnchors.get(first.id)}">${e(`${node.number ? `${node.number} · ` : ""}${node.title}`)}</a></li>`] : []; });
  const body = `<header><span class="brand">Aw · shared reading copy</span><h1>${e(document.project.name)}</h1><p>${e(createdAt)} · manuscript ${e(document.project.mainFile)}</p><p>Saved snapshot, not a live workspace. Manuscript formatting is a reading approximation, not a typeset PDF. Questions and model replies are not verified conclusions. No code runs on opening this page.</p></header><nav aria-label="Contents"><a href="#manuscript">Manuscript</a><a href="#notebook">Notebook (${entries.length})</a><a href="manuscript.md">Manuscript Markdown</a><a href="notebook.md">Notebook Markdown</a></nav><main><section id="manuscript"><h2>Manuscript</h2>${contents.length > 1 ? `<details class="reader-contents"><summary>Contents</summary><ol>${contents.join("")}</ol></details>` : ""}${document.structureIssue ? `<p class="warning">${e(document.structureIssue)}</p>` : ""}${manuscriptHtml.join("") || "<p>No manuscript paragraphs.</p>"}</section><section id="notebook"><h2>Notebook</h2><p class="muted">${omittedCells} hidden, filed or trashed cells omitted. Recovery conversations and trashed cells are never included.</p><ol class="contents">${entries.map((entry, i) => `<li><a href="#conversation-${i + 1}">${e(entry.title)}</a></li>`).join("")}</ol>${notebookHtml.join("") || "<p>No conversations selected.</p>"}</section></main><footer>Exported with Active Writing. Do not execute notebook code without reviewing it. Internal prompt packets, workspace-path metadata and executable rich outputs are not exported; authored text may still contain private information.</footer>`;
  files.push({ name: "manuscript.md", data: Buffer.from(`# ${document.project.name}\n\nReading approximation · ${document.project.mainFile}\n\n${manuscriptMarkdown.join("\n\n")}\n`) }, { name: "notebook.md", data: Buffer.from(`# ${document.project.name} · Notebook\n\nSaved snapshot ${createdAt}. Numerical findings are not proof. ${omittedCells} hidden/filed/trashed cells omitted.\n\n${notebookMarkdown.join("\n\n")}\n`) });
  return { files, body, omittedCells };
}

const css = `:root{color-scheme:light}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:1rem}body{margin:0;background:#f4f3ef;color:#243139;font:16px/1.65 system-ui,sans-serif}header,main,footer{max-width:1000px;margin:auto;padding:32px}header{padding-bottom:18px}h1{font-size:2rem;margin:.3em 0}h2{border-bottom:1px solid #d0d5d2;padding-bottom:8px;margin-top:2em}h3,h4{line-height:1.4}a{color:#2563a6;text-underline-offset:3px}.brand,.muted{color:#657079;font-size:.85rem}nav{max-width:936px;margin:auto;display:flex;gap:16px;flex-wrap:wrap;padding:14px 0;border-block:1px solid #d0d5d2}main{padding-top:0}.conversation{background:#fff;border:1px solid #dce1df;border-radius:10px;padding:24px;margin:20px 0}.cell{border-top:1px solid #e0e4e2;padding-top:12px;margin-top:24px}.passage{font-family:Georgia,serif}.passage p{margin:1em 0}details{margin:12px 0}summary{cursor:pointer;font-size:.9rem;color:#47606d}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f5;padding:12px;border-radius:6px;font:12px/1.55 Consolas,monospace}code{font-size:.85em}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #d8dddf;padding:6px 9px;text-align:left}.table-scroll,.reply-table-scroll{overflow:auto}img,svg{max-width:100%;height:auto}figure{margin:18px 0}figcaption{font-weight:600;font-size:.9rem}.legend{font-size:.8rem}.warning{background:#fff0d7;padding:10px;border-radius:4px;font-size:.85rem}.katex{font-size:1.03em}.katex-display{overflow:auto;padding:5px;margin:.8em 0}.contents{columns:2}footer{font-size:.8rem;color:#657079}svg text{font:12px system-ui}.output{margin-top:10px}@media(max-width:650px){header,main,footer{padding:20px}nav{margin:0 20px}.conversation{padding:16px}.contents{columns:1}}@media print{body{background:white}details{break-inside:avoid}nav,footer{display:none}.conversation{border:none;padding:0}a{color:inherit}}`;
const require = createRequire(import.meta.url);
export async function collaboratorExport(workspace: string, request: { projectId: string; mainFile: string; revision: string; notebookRevision: number; entryId?: string; includeNotebook?: boolean; includeFiled?: boolean; includeSource?: boolean; format?: "pdf" | "html" | "zip" | "web" | "overview"; overviewFile?: string; noteFiles?: string[]; repositoryUrl?: string }, pdfRenderer = renderSharingPdf) {
  if (!request || !/^[A-Za-z0-9_-]{1,64}$/.test(request.projectId) || !Number.isSafeInteger(request.notebookRevision) || request.entryId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(request.entryId) || [request.includeNotebook, request.includeFiled, request.includeSource].some(value => value !== undefined && typeof value !== "boolean")) throw new Error("Choose a valid saved project and sharing options.");
  if (request.includeNotebook === false && request.entryId) throw new Error("Choose no notebook or a conversation, not both.");
  if (request.format !== undefined && !["pdf", "html", "zip", "web", "overview"].includes(request.format)) throw new Error("Choose PDF, HTML or ZIP, or a project reader.");
  const format = request.format ?? "pdf";
  const reader = format === "web" || format === "overview";
  const document = await parseProject(workspace, request.projectId), notebook = await readNotebook(workspace, request.projectId);
  if (document.project.mainFile !== request.mainFile || document.revision !== request.revision || notebook.revision !== request.notebookRevision) throw new Error("Manuscript or notes changed. Wait for saves to finish, then export again.");
  const repo = reader ? repositoryLink(request.repositoryUrl) : undefined;
  if (request.noteFiles !== undefined && (!Array.isArray(request.noteFiles) || request.noteFiles.length > 8 || request.noteFiles.some(file => typeof file !== "string" || !document.rootFiles.includes(file)) || new Set(request.noteFiles).size !== request.noteFiles.length)) throw new Error("Choose up to eight distinct notes manuscripts in this project.");
  if (request.overviewFile !== undefined && (typeof request.overviewFile !== "string" || !document.rootFiles.includes(request.overviewFile) || document.project.manuscriptPurposes?.[request.overviewFile] !== "overview")) throw new Error("Choose a saved Overview manuscript in this project.");
  if (request.entryId && !notebook.entries.some(entry => entry.id === request.entryId && !entry.recoveryKey)) throw new Error("Choose a saved conversation in this project.");
  const overviewFile = request.overviewFile ?? (document.project.manuscriptPurposes?.[request.mainFile] === "overview" ? request.mainFile : undefined);
  const readingFile = reader && overviewFile === request.mainFile ? document.project.manuscriptOverviewTargets?.[request.mainFile] ?? request.mainFile : request.mainFile;
  if (!document.rootFiles.includes(readingFile)) throw new Error("The Overview's linked manuscript is missing. Choose its main manuscript before sharing.");
  const readingDocument = readingFile === request.mainFile ? document : await parseProject(workspace, request.projectId, false, readingFile);
  const scope = request.entryId ? notebook.entries : notebookForManuscript(notebook.entries, readingFile);
  const entries = request.includeNotebook === false ? [] : orderedNotebookEntries(scope).filter(entry => !entry.recoveryKey && (request.entryId ? entry.id === request.entryId : request.includeFiled || !entry.filed));
  if (entries.length > 100) throw new Error("Share at most 100 conversations at once; choose the current conversation for a smaller export.");
  const stores = new Map<string, ExperimentStore>(); let bytes = 0;
  for (const entry of format === "overview" ? [] : entries) {
    const owner = entry.experimentNotebookId ?? entry.id; if (stores.has(owner)) continue;
    const store = await readExperiments(workspace, request.projectId, owner); bytes += Buffer.byteLength(JSON.stringify(store.notebook));
    if (bytes > 40_000_000) throw new Error("Saved experiments exceed 40 MB; share a single conversation instead.");
    stores.set(owner, store);
  }
  const figures = new Map<string, string>();
  const overview = reader && overviewFile ? overviewFile === request.mainFile ? document : await parseProject(workspace, request.projectId, false, overviewFile) : undefined;
  const notes = reader ? await Promise.all((request.noteFiles ?? []).filter(file => file !== overviewFile && file !== readingFile).map(file => parseProject(workspace, request.projectId, false, file))) : [];
  for (const doc of [...(format === "overview" ? [] : [readingDocument]), ...(overview ? [overview] : []), ...notes]) for (const p of doc.paragraphs) for (const match of uncomment(p.text).matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^{}]+)\}/g)) {
    const key = `${p.file ?? doc.project.mainFile}:${match[1]}`; if (figures.has(key)) continue;
    const base = path.posix.normalize(match[1].replaceAll("\\", "/")), candidates = [base, path.posix.join(path.posix.dirname(p.file ?? doc.project.mainFile), base)];
    const file = candidates.flatMap(candidate => [candidate, ...["png", "jpg", "jpeg", "webp", "gif"].map(ext => `${candidate}.${ext}`)]).find(name => document.files.includes(name) && /\.(png|jpe?g|webp|gif)$/i.test(name));
    if (!file) continue;
    const image = await projectFileContent(workspace, request.projectId, file); bytes += image.data.length;
    if (bytes > 40_000_000) throw new Error("Saved figures and experiments exceed 40 MB. Share a smaller project.");
    figures.set(key, `data:${image.mime};base64,${image.data.toString("base64")}`);
  }
  const createdAt = new Date().toISOString(), pages = collaborationPages(readingDocument, entries, stores, Boolean(request.includeFiled), createdAt, figures);
  let files = pages.files;
  const katexFolder = path.dirname(require.resolve("katex/dist/katex.min.css"));
  const katexLicense = await readFile(path.join(katexFolder, "..", "LICENSE"));
  if (format === "zip" || format === "web") files.push({ name: "LICENSE-KaTeX.txt", data: katexLicense });
  let mathCss = await readFile(path.join(katexFolder, "katex.min.css"), "utf8");
  for (const match of [...mathCss.matchAll(/url\(fonts\/([A-Za-z0-9_-]+\.(?:woff2?|ttf))\)/g)]) {
    const font = await readFile(path.join(katexFolder, "fonts", match[1]));
    mathCss = mathCss.replace(match[0], `url(data:font/${match[1].split(".").at(-1)};base64,${font.toString("base64")})`);
  }
  const htmlOnly = format !== "zip" && format !== "web";
  if (format === "zip" && request.includeSource !== false) for (const file of await sourceEntries(workspace, request.projectId)) files.push({ name: `source/${file.name}`, data: file.data });
  const body = htmlOnly ? pages.body.replace(/<a href="(?:manuscript\.md|notebook\.md)"[^>]*>[^<]*<\/a>/g, "").replace(/<p><a href="notebooks\/[^"]+" download>[^<]*<\/a><\/p>/g, "") : pages.body;
  const wrap = (body: string, title = document.project.name) => Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${e(title)} · shared reading copy</title><style>/* KaTeX stylesheet and fonts: ${katexLicense.toString().replaceAll("*/", "* /")} */\n${mathCss}\n${css}</style></head><body>${body}</body></html>`);
  const html = wrap(body);
  // Render before the final revision checks: even a slow print must not send
  // an earlier manuscript paired with notebook data that changed meanwhile.
  let pdf = format === "pdf" ? await pdfRenderer(Buffer.from(sharingPdfHtml(html.toString()))) : undefined;
  if (reader) {
    files = files.filter(file => entries.length || file.name !== "notebook.md").map(file => file.name.endsWith(".md") ? { ...file, data: Buffer.from(portableReadingMarkdown(file.data.toString())) } : file);
    const summary = overview ? collaborationPages(overview, [], new Map(), false, createdAt, figures).body.match(/<section id="manuscript">([\s\S]*?)<\/section>/)?.[1]?.replace(/^<h2>Manuscript<\/h2>/, "") ?? "" : "";
    const resources = [{ title: readingFile, href: "reading.html#manuscript", detail: "Main manuscript · readable copy, not exact TeX typesetting" }, ...entries.map((entry, i) => ({ title: entry.title, href: `reading.html#conversation-${i + 1}`, detail: "Selected notebook · saved notes and experiments" })), ...notes.map((note, i) => ({ title: note.project.mainFile, href: `notes/note-${i + 1}.html#manuscript`, detail: "Research notes" }))];
    const resolve = (href: string) => {
      let url: URL; try { url = new URL(href); } catch { return undefined; }
      if (url.searchParams.get("awProject") !== request.projectId) return undefined;
      if (url.searchParams.get("awPanel") === "notebook") {
        const index = entries.findIndex(entry => entry.id === url.searchParams.get("awNotebook")); if (index < 0) return undefined;
        const entry = entries[index], store = stores.get(entry.experimentNotebookId ?? entry.id), id = url.searchParams.get("awCell");
        const cell = store?.notebook.cells.find(cell => cell.id === id && !cell.metadata.paperfocus?.deleted && (request.includeFiled || !cell.metadata.paperfocus?.filed && !cell.metadata.paperfocus?.suppressed));
        if (id && !cell || url.searchParams.has("awEvidence") && String(store?.revision) !== url.searchParams.get("awEvidence")) return undefined;
        const output = url.searchParams.get("awOutput");
        if (output !== null && (!cell || !/^\d+$/.test(output) || !cell.outputs?.[Number(output)])) return undefined;
        return `reading.html#${cell ? output !== null ? `output-${index + 1}-${cell.id}-${Number(output)}` : `cell-${index + 1}-${cell.id}` : `conversation-${index + 1}`}`;
      }
      if (url.searchParams.get("awPanel") !== "paper") return undefined;
      const root = url.searchParams.get("awRoot"), doc = [readingDocument, ...notes, ...(overview ? [overview] : [])].find(doc => doc.project.mainFile === root); if (!doc) return undefined;
      const index = doc === readingDocument ? -1 : notes.indexOf(doc), file = doc === overview ? "index.html" : index < 0 ? "reading.html" : `notes/note-${index + 1}.html`;
      const id = url.searchParams.get("awParagraph");
      if (!id) return doc === overview ? file : `${file}#manuscript`;
      if (url.searchParams.get("awRevision") !== doc.revision) return undefined;
      const paragraph = doc.paragraphs.findIndex(p => p.id === id); return paragraph < 0 ? undefined : `${file}#passage-${paragraph}`;
    };
    const overviewHtml = wrap(`${overviewBody(document.project.name, portableReaderLinks(summary, true, resolve), resources, repo)}<nav aria-label="Downloads"><a href="overview.pdf" download>Download overview PDF</a><a href="reader.zip" download>Download reading bundle</a></nav>`);
    // Offline overview names its resources but contains no local/project links.
    const offlineOverview = wrap(overviewBody(document.project.name, portableReaderLinks(summary), resources.map(({ title, detail }) => ({ title, detail })), repo));
    pdf = await pdfRenderer(Buffer.from(sharingPdfHtml(offlineOverview.toString())));
    if (format === "web") {
      const readingBody = pages.body.replace(/<details(?: open)?><summary>Read notes, replies & experiments/g, "<details open><summary>Read notes, replies & experiments")
        .replace(entries.length ? /$^/ : /<a href="(?:#notebook|notebook\.md)">[\s\S]*?<\/a>|<section id="notebook">[\s\S]*?<\/section>/g, "");
      files.push({ name: "reading.html", data: wrap(portableReaderLinks(`<nav><a href="index.html">Overview</a><a href="overview.pdf" download>Download overview PDF</a></nav>${readingBody}`, true, resolve)) });
      notes.forEach((note, i) => files.push({ name: `notes/note-${i + 1}.html`, data: wrap(`<nav><a href="../index.html">Overview</a></nav>${portableReaderLinks(collaborationPages(note, [], new Map(), false, createdAt, figures).body, true, href => { const link = resolve(href); return link ? `../${link}` : undefined; })}`, note.project.mainFile) }));
      files.push({ name: "index.html", data: overviewHtml }, { name: "overview.pdf", data: pdf });
      files = compactReaderFiles(files);
      files.push({ name: "README.txt", data: Buffer.from("Active Writing reader snapshot. Place this aw/ folder in the paper repository; live Aw records stay outside the checkout. Do not publish this folder as ordinary public GitHub Pages. Serve it through the separate code-protected read-only reader. Codes/tokens are hosting secrets, never repository files. Review every selected note before sharing. The overview PDF is self-contained and contains no local project links. This is not an Aw backup or editable workspace. No notebook code runs here.\n") });
      if (files.length > 96 || files.reduce((n, f) => n + (f.name.endsWith(".pdf") || /\.(?:png|jpe?g|gif|webp|woff2?|ttf)$/.test(f.name) ? 0 : f.data.length), 0) > 6_000_000 || files.reduce((n, f) => n + f.data.length, 0) > 100_000_000) throw new Error("Reader exceeds the small-repository budget (96 files, 6 MB text or 100 MB total). Select fewer conversations or notes.");
      const readerManifest = { version: 1, format: "active-writing-reader", createdAt, files: files.map(file => ({ name: file.name, sha256: createHash("sha256").update(file.data).digest("hex") })) };
      files.push({ name: "reader.json", data: Buffer.from(JSON.stringify(readerManifest, null, 2)) });
      files = files.map(file => ({ ...file, name: `aw/${file.name}` }));
    }
  }
  if (!reader) files.push({ name: "START_HERE.html", data: html });
  files.push({ name: "README.txt", data: Buffer.from("Extract this ZIP, then open START_HERE.html in a browser. No Aw installation, login or internet is required.\n\nManuscript: reading approximation, not exact TeX typesetting.\nNotebook: selected conversations and saved displays. Code is folded and never runs in this page.\nMarkdown files: editable reading copies. notebooks/: ordinary Jupyter copies; review before executing; Aw display helpers may be required. source/: ordinary project files, when selected.\nThis is a sharing copy, not a complete Aw backup/import. Recovery notes, trashed cells, archived prompt packets and local workspace paths are not exported. Unsupported executable rich outputs are omitted. User-authored text/code can still contain private information; review before forwarding.\n") });
  // Fail instead of mixing an earlier manuscript with a later notebook or run.
  const latest = await getProject(workspace, request.projectId);
  if (latest.project.mainFile !== request.mainFile || await projectRevision(latest.root, await projectFiles(latest.root)) !== request.revision || (await readNotebook(workspace, request.projectId)).revision !== notebook.revision) throw new Error("The workspace changed during export. Try again after saves finish.");
  for (const [owner, store] of stores) if ((await readExperiments(workspace, request.projectId, owner)).revision !== store.revision) throw new Error("An experiment finished or changed during export. Try again to include its latest result.");
  if (files.length > 6000 || files.reduce((total, file) => total + file.data.length, 0) > 150_000_000) throw new Error("Sharing bundle is too large. Export a single conversation without source files.");
  const manifest = { version: 1, format: "active-writing-sharing-copy", createdAt, project: { name: document.project.name, mainFile: request.mainFile, revision: request.revision }, notebookRevision: notebook.revision, conversations: entries.length, omittedCells: pages.omittedCells, files: files.map(file => ({ name: file.name, sha256: createHash("sha256").update(file.data).digest("hex") })) };
  files.push({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) });
  return pdf && format !== "web" ? { data: pdf, mime: "application/pdf", extension: "pdf" } : htmlOnly ? { data: html, mime: "text/html; charset=utf-8", extension: "html" } : { data: await zipEntries(reader ? files.filter(file => file.name.startsWith("aw/")) : files), mime: "application/zip", extension: "zip" };
}
