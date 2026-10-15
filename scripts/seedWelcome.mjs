// Seed only a brand-new installation. Never reset a user's example or records.
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject } from "../server/projects.ts";
import { writeNotebook } from "../server/notebookStore.ts";
import { readExperiments, writeExperiments } from "../server/experiments.ts";
import { newExperimentNotebook } from "../src/experiments.ts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exists = async file => { try { await lstat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
export async function seedWelcome(workspace = appRoot) {
  const home = path.join(workspace, ".paperfocus"), target = path.join(home, "projects.json");
  if (await exists(target)) return { seeded: false, reason: "Existing project registry preserved." };
  const source = await readFile(path.join(workspace, "demo-paper/main.tex"), "utf8");
  if (!source.includes("Welcome to Active Writing") || !source.includes("\\input{sections/start}")) return { seeded: false, reason: "Existing example preserved." };
  // A prior partially completed setup or normal app visit may already own data.
  if (await exists(path.join(home, "project-data"))) return { seeded: false, reason: "Existing Aw records preserved." };
  await mkdir(home, { recursive: true });
  const claim = await open(path.join(home, "welcome-setup.lock"), "wx");
  try {
    if (await exists(target) || await exists(path.join(home, "project-data"))) return { seeded: false, reason: "Setup or app already created records." };
    const document = await parseProject(workspace), now = new Date().toISOString();
    const paragraph = document.paragraphs.find(p => p.text.includes("finite geometric series"));
    const node = document.nodes.find(n => n.id === paragraph?.nodeId);
    const entry = { id: "welcome-series", manuscriptFile: "main.tex", title: "Try a question and a small experiment", question: "How does the partial sum approach its limit when 0 < r < 1?", notes: "This is a synthetic walkthrough. Read the saved cells, run the experiment only if you choose, then try filing or pinning it. The appendix gives the proof; the numerical check is an illustration.", reply: "", proposal: "", status: "open", route: "chatgpt", effort: 1, pinned: true, pinMode: "experiments", handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now,
      ...(paragraph ? { source: { rootFile: "main.tex", paragraphId: paragraph.id, nodeId: paragraph.nodeId, nodeTitle: node?.title ?? "Example", file: paragraph.file, revision: document.revision, paragraphText: paragraph.text, start: 0, end: paragraph.text.length, excerpt: paragraph.text } } : {}) };
    const notebook = newExperimentNotebook();
    notebook.cells = [
      { id: "welcome-plan", cell_type: "markdown", metadata: { paperfocus: { title: "A small research record", pinned: true } }, source: "## Partial sums of a geometric series\n\nFor $0<r<1$, the finite sum is $S_n=(1-r^{n+1})/(1-r)$ and its limit is $1/(1-r)$.\n\nThe experiment compares three values of $r$. A value closer to one approaches its limit more slowly. Edit the parameters, inspect the saved values and keep observations here. This cell and its code are synthetic examples, not inherited research or a claimed execution." },
      { id: "welcome-compute", cell_type: "code", metadata: { paperfocus: { title: "Compare partial sums", pinned: true } }, source: "# Standard library only. Aw supplies display_table and display_plot.\nrows = []\nseries = []\nfor r in (0.25, 0.5, 0.8):\n    points = []\n    for n in range(13):\n        value = sum(r ** k for k in range(n + 1))\n        expected = (1 - r ** (n + 1)) / (1 - r)\n        assert abs(value - expected) < 1e-10\n        points.append([n, value])\n        if n in (0, 4, 12):\n            rows.append({'r': r, 'n': n, 'partial sum': value, 'limit': 1 / (1 - r)})\n    series.append({'name': 'r = ' + str(r), 'points': points})\ndisplay_table(rows)\ndisplay_plot('Partial sums', series)\nprint('Finite checks passed; the manuscript proof covers all n.')\n", outputs: [], execution_count: null },
      { id: "welcome-observations", cell_type: "markdown", metadata: { paperfocus: { title: "Your observations" } }, source: "Write what you learn here. You can pin this note, reorder it, suppress it, or file it away. Keep a useful conclusion near the text; retain the code and values as evidence. Nothing in this template has been run automatically." },
    ];
    const store = await readExperiments(workspace, "demo", entry.id);
    await writeExperiments(workspace, "demo", entry.id, store.revision, notebook);
    await writeNotebook(workspace, "demo", 0, [entry], "");
    // Exclusive creation never replaces a concurrently registered project.
    const registry = await open(target, "wx");
    try { await registry.writeFile(JSON.stringify({ activeId: "demo", projects: [{ id: "demo", name: "Welcome to Aw", folder: "demo-paper", mainFile: "main.tex", createdAt: now, manuscriptPurposes: { "main.tex": "notes", "overview.tex": "overview" }, manuscriptOverviewTargets: { "overview.tex": "main.tex" } }] }, null, 2)); } finally { await registry.close(); }
    return { seeded: true, projectId: "demo", entryId: entry.id };
  } finally {
    await claim.close();
    // Keep a receipt, not a recurring initialization trigger. Existing records
    // always win on a later setup; interrupted preparations are not overwritten.
  }
}
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) seedWelcome().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
