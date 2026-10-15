// Isolated visual QA: synthetic saved evidence only, no Python or user papers.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPaperProject } from "../server/projectFiles.ts";
import { parseProject } from "../server/projects.ts";
import { writeNotebook } from "../server/notebookStore.ts";
import { writeExperiments } from "../server/experiments.ts";
import { collaboratorExport } from "../server/collaboratorExport.ts";
import { newExperimentCell, newExperimentNotebook } from "../src/experiments.ts";
import type { NotebookEntry } from "../src/types.ts";

const base = path.resolve(".paperfocus/trials"); await mkdir(base, { recursive: true });
const workspace = await mkdtemp(path.join(base, "sharing-pdf-"));
const tex = String.raw`\documentclass{article}
\usepackage{amsmath,amssymb}
\begin{document}
\section{Transport stability}
We study a candidate perturbation estimate for entropic transport. This synthetic example tests the sharing view, not a recovered theorem.

For probability measures $\mu$ and $\nu$, write the candidate objective as
$$\mathcal T_\varepsilon(\mu,\nu)=\inf_{\pi\in\Pi(\mu,\nu)}\left\{\int c(x,y)\,d\pi+\varepsilon\,\mathrm{KL}(\pi\mid\mu\otimes\nu)\right\}.$$

The question is which assumptions control the constants. Numerical samples below illustrate a display; they are not proof or executed experiments.
\subsection{A proposed estimate}
Suppose the test functions are bounded. The proposed stability inequality is
$$|\mathcal T_\varepsilon(\mu,\nu)-\mathcal T_\varepsilon(\widetilde\mu,\nu)|\le C_\varepsilon\|\mu-\widetilde\mu\|_{\mathrm{TV}}.$$

The notebook distinguishes the proposal, its unresolved assumptions, and saved illustrative values.
\section{Next checks}
Check normalization, the dual objective, and the dependence on $\varepsilon$. Preserve open questions when sharing.
\end{document}`;
const project = await createPaperProject(workspace, "Transport stability - sharing example", [{ path: "main.tex", data: Buffer.from(tex).toString("base64") }]);
const document = await parseProject(workspace, project.id), passage = document.paragraphs[0], time = "2026-10-06T12:00:00Z";
const entries: NotebookEntry[] = [
  { id: "derivation", title: "Candidate derivation", question: "Which assumptions justify the dual perturbation step?", notes: "## Open point\n\nThe dual potentials need a uniform bound.\n\n| Assumption | Status |\n|---|---|\n| Bounded cost | Explicit |\n| Uniform potential bound | Not established |", reply: String.raw`For a feasible potential $f$, a possible step is

$$\left|\int f\,d(\mu-\widetilde\mu)\right|\le \|f\|_\infty\|\mu-\widetilde\mu\|_{\mathrm{TV}}.$$

This does not establish the required bound on $f$. **The argument remains incomplete.**`,
    proposal: "No manuscript change proposed until the missing assumption is settled.", status: "open", route: "codex", effort: 2, cataloguePosition: 0, createdAt: time, updatedAt: time, handoffs: [], appliedChanges: [], source: { rootFile: project.mainFile, paragraphId: passage.id, nodeId: passage.nodeId, nodeTitle: "Transport stability", file: passage.file, paragraphText: passage.text, excerpt: passage.text, start: 0, end: passage.text.length, revision: document.revision } },
  { id: "checks", title: "Illustrations and reproducibility", question: "Do the displays remain readable in the emailed PDF?", notes: "This later, normally folded conversation must also appear in full.\n\nThe values are manually supplied QA samples. No simulation was executed.", reply: "END_OF_LATER_REPLY - this sentence must survive PDF expansion.", proposal: "", status: "open", route: "local", effort: 0, cataloguePosition: 1, createdAt: time, updatedAt: time, handoffs: [], appliedChanges: [] },
];
const notebook = await writeNotebook(workspace, project.id, 0, entries);
const nb = newExperimentNotebook();
const plot = { title: "Illustrative decay (synthetic saved data)", xLabel: "sample size", yLabel: "difference", series: [{ name: "candidate", points: [[10, .4], [20, .28], [50, .18], [100, .12]] }, { name: "comparison", points: [[10, .5], [20, .36], [50, .24], [100, .17]] }] };
nb.cells = [
  { ...newExperimentCell("markdown"), id: "summary", source: String.raw`### What the display can establish

Nothing mathematical: these values are synthetic. This is an export/layout trial.

$$C_\varepsilon\quad\text{is still undetermined.}$$`, metadata: { paperfocus: { title: "Interpretation", pinned: true } } },
  { ...newExperimentCell("code"), id: "long-code", source: Array.from({ length: 75 }, (_, i) => `# Illustrative line ${i + 1}: review assumptions before implementing the experiment.`).join("\n") + "\n# END_OF_LONG_CODE", metadata: { paperfocus: { title: "Code spanning pages" } }, outputs: [{ output_type: "display_data", data: { "application/vnd.paperfocus.plot+json": plot, "application/vnd.paperfocus.heatmap+json": { title: "Saved sample grid", xLabel: "epsilon", yLabel: "noise", x: [.1, .2, .5], y: [0, .1, .2], values: [[.1, .2, .3], [.2, .3, .4], [.3, .4, .5]] }, "application/vnd.paperfocus.sweep+json": { title: "Two saved frames", parameter: "epsilon", initial: 0, frames: [{ value: .1, plot }, { value: .5, plot: { ...plot, title: "END_OF_LAST_FRAME" } }] }, "text/plain": "Synthetic values only. END_OF_SAVED_OUTPUT" } }] },
];
await writeExperiments(workspace, project.id, "checks", "", nb);
const request = { projectId: project.id, mainFile: project.mainFile, revision: document.revision, notebookRevision: notebook.revision };
const result = await collaboratorExport(workspace, request);
const output = path.resolve("output/pdf/aw-sharing-example.pdf"); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, result.data);
console.log(JSON.stringify({ workspace, projectId: project.id, output, bytes: result.data.length }));
