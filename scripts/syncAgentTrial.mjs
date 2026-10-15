// Offline end-to-end agent example. Two isolated synthetic data homes; no remote host,
// user paper, scientific execution, app server or selected-project change.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPaperProject } from "../server/projectFiles.ts";
import { getProject } from "../server/projects.ts";
import { initializeSyncDevice, privateSyncPath } from "../server/deviceSync.ts";
import { writeNotebook } from "../server/notebookStore.ts";
import { writeWorkbench } from "../server/workbenchStore.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { readExperiments, writeExperiments } from "../server/experiments.ts";
import { newExperimentNotebook } from "../src/experiments.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parent = path.join(root, ".paperfocus/trials"); await mkdir(parent, { recursive: true });
const workspace = await mkdtemp(path.join(parent, "agent-transfer-")), project = await createPaperProject(workspace, "Synthetic offline transfer"), paper = (await getProject(workspace, project.id)).root;
await initializeSyncDevice(workspace, "Trial laptop"); await writeWorkbench(workspace, project.id, 0, emptyWorkbench());
const source = String.raw`\documentclass{article}
\begin{document}
\section{Question}
An initial explanation.

A stable paragraph of context.

\section{Next idea}
An initial observation.
\end{document}
`;
await writeFile(path.join(paper, "main.tex"), source);
const stamp = new Date().toISOString();
const entry = (id, notes) => ({ id, title: id, question: "Synthetic transfer example", notes, reply: "", proposal: "", status: "open", route: "codex", effort: 2, handoffs: [], appliedChanges: [], createdAt: stamp, updatedAt: stamp });
await writeNotebook(workspace, project.id, 0, [entry("question", "Initial note")]);
const initialExperiment = await writeExperiments(workspace, project.id, "question", "", { ...newExperimentNotebook(), metadata: { synthetic: true }, cells: [
  { id: "human-note", cell_type: "markdown", source: "Initial human idea", metadata: {} },
  { id: "desktop-note", cell_type: "markdown", source: "Initial desktop idea", metadata: {} }
] });
const run = promisify(execFile), commands = [];
async function cliAt(home, command, ...flags) {
  const started = performance.now();
  const scope = command === "clone" ? [] : ["--workspace", home, "--project", project.id];
  const { stdout } = await run(process.execPath, [path.join(root, "scripts/awSync.ts"), command, ...scope, ...flags], { cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  commands.push({ command, milliseconds: Math.round(performance.now() - started) }); return JSON.parse(stdout);
}
const cli = (command, ...flags) => cliAt(workspace, command, ...flags);
const baseline = await cli("checkpoint"), desktopHome = path.join(workspace, "desktop-data");
const cloneScope = ["--file", baseline.path, "--destination", desktopHome, "--main-file", "main.tex", "--label", "Trial desktop"];
const firstCopy = await cli("clone", ...cloneScope), copied = await cli("clone", ...cloneScope, "--plan", firstCopy.planId, "--commit");
assert.equal(copied.projectId, project.id); assert.equal(copied.codeExecution, false);
const inspection = await run(process.execPath, [path.join(root, "scripts/awResearch.ts"), "inspect", "--offline", "--workspace", desktopHome, "--project", project.id, "--entry", "question"], { cwd: desktopHome, windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
assert.equal(JSON.parse(inspection.stdout).projectId, project.id);
assert.equal(JSON.parse(inspection.stdout).notebookId, "question");
const localText = source.replace("An initial explanation.", "The human's offline clarification.");
await writeFile(path.join(paper, "main.tex"), localText);
await writeNotebook(workspace, project.id, 1, [entry("question", "Human offline note")]);
const localExperiment = structuredClone(initialExperiment.notebook); localExperiment.cells[0].source = "The human's saved notebook clarification";
await writeExperiments(workspace, project.id, "question", initialExperiment.revision, localExperiment);
const local = await cli("checkpoint", "--parent", baseline.id);
const remoteText = source.replace("An initial observation.", "A separate synthetic desktop finding.");
const desktopPaper = (await getProject(desktopHome, project.id)).root;
await writeFile(path.join(desktopPaper, "main.tex"), remoteText);
await writeNotebook(desktopHome, project.id, 1, [entry("question", "Initial note"), entry("desktop-note", "Synthetic finding; no experiment was executed.")]);
await writeExperiments(desktopHome, project.id, "desktop-note", "", { ...newExperimentNotebook(), cells: [{ id: "state", cell_type: "markdown", source: "A separate saved desktop research question", metadata: {} }] });
const desktopExperiment = await readExperiments(desktopHome, project.id, "question"); desktopExperiment.notebook.cells[1].source = "The desktop's independent saved deduction";
await writeExperiments(desktopHome, project.id, "question", desktopExperiment.revision, desktopExperiment.notebook);
const remote = await cliAt(desktopHome, "checkpoint", "--parent", baseline.id);
await cli("stage", "--file", remote.path);
const compared = await cli("compare", "--local", local.id, "--remote", remote.id);
const brief = await privateSyncPath(workspace, "trial-agent-brief.md", true);
const index = await cli("changes", "--plan", compared.planId, "--brief", brief);
assert.equal(index.conflictCount, 1); assert.equal(index.conflicts[0].ordinaryTextAllowed, true);
await cli("conflict", "--plan", compared.planId, "--conflict", index.conflicts[0].id);
const proposal = await cli("reconcile", "--plan", compared.planId);
assert.equal(proposal.remaining.length, 0);
const prepared = await cli("prepare", "--plan", compared.planId, "--proposal", proposal.id);
const candidateSource = await readFile(path.join(prepared.folder, "candidates/source/main.tex"), "utf8");
assert.equal(candidateSource, localText.replace("An initial observation.", "A separate synthetic desktop finding."));
const candidateNotebook = JSON.parse(await readFile(path.join(prepared.folder, "candidates/data/notebook.json"), "utf8"));
assert.deepEqual(candidateNotebook.entries.map(item => item.notes).sort(), ["Human offline note", "Synthetic finding; no experiment was executed."].sort());
assert.equal(await readFile(path.join(paper, "main.tex"), "utf8"), localText);
const liveNotebook = JSON.parse(await readFile(path.join(workspace, ".paperfocus/project-data", project.id, "notebook.json"), "utf8"));
assert.equal(liveNotebook.entries.length, 1);
assert.equal(await readFile(path.join(desktopPaper, "main.tex"), "utf8"), remoteText);
const collectPath = "data/experiments/question/notebook.ipynb", reviewed = await cli("collect", "--plan", compared.planId, "--path", collectPath);
assert.equal(reviewed.liveImport, false);
const collected = await cli("collect", "--plan", compared.planId, "--path", collectPath, "--review", reviewed.collectionId, "--commit");
const collectionState = await cli("collect-status", "--collection", collected.collectionId);
assert.equal(collectionState.completed, true); assert.equal(collected.codeExecuted, false);
const combinedExperiments = await readExperiments(workspace, project.id, "question");
assert.deepEqual(combinedExperiments.notebook.cells.map(cell => cell.source), ["The human's saved notebook clarification", "The desktop's independent saved deduction"]);
assert.equal(await readFile(path.join(paper, "main.tex"), "utf8"), localText);
assert.equal((JSON.parse(await readFile(path.join(workspace, ".paperfocus/project-data", project.id, "notebook.json"), "utf8"))).entries.length, 1);
// Reverse the direction: the laptop starts a genuinely new conversation, and
// the cloned desktop receives it without replacing its own conversations.
const laptopCatalogue = JSON.parse(await readFile(path.join(workspace, ".paperfocus/project-data", project.id, "notebook.json"), "utf8"));
laptopCatalogue.entries.push(entry("laptop-followup", "New human direction while offline"));
await writeNotebook(workspace, project.id, laptopCatalogue.revision, laptopCatalogue.entries);
await writeExperiments(workspace, project.id, "laptop-followup", "", { ...newExperimentNotebook(), metadata: { synthetic: true }, cells: [
  { id: "state", cell_type: "markdown", source: "New laptop idea, retained alongside the desktop's research", metadata: { paperfocus: { pinned: true } } },
  { id: "next-test", cell_type: "code", source: "# Proposed experiment only; no execution", metadata: {}, execution_count: null, outputs: [] }
] });
const laptopHead = await cli("checkpoint", "--parent", local.id);
await cliAt(desktopHome, "stage", "--file", local.path);
await cliAt(desktopHome, "stage", "--file", laptopHead.path);
const reversePlan = await cliAt(desktopHome, "compare", "--local", remote.id, "--remote", laptopHead.id);
const conversationReview = await cliAt(desktopHome, "collect", "--plan", reversePlan.planId, "--entries", "laptop-followup");
const conversationCollected = await cliAt(desktopHome, "collect", "--plan", reversePlan.planId, "--entries", "laptop-followup", "--review", conversationReview.collectionId, "--commit");
const conversationStatus = await cliAt(desktopHome, "collect-status", "--collection", conversationCollected.collectionId);
assert.equal(conversationStatus.completed, true); assert.equal(conversationStatus.tasksCompleted, false);
const desktopCatalogue = JSON.parse(await readFile(path.join(desktopHome, ".paperfocus/project-data", project.id, "notebook.json"), "utf8"));
assert.deepEqual(desktopCatalogue.entries.map(item => item.id), ["question", "desktop-note", "laptop-followup"]);
const finalInspection = await run(process.execPath, [path.join(root, "scripts/awResearch.ts"), "inspect", "--offline", "--workspace", desktopHome, "--project", project.id, "--entry", "laptop-followup"], { cwd: desktopHome, windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
assert.equal(JSON.parse(finalInspection.stdout).notebookId, "laptop-followup");
assert.equal(await readFile(path.join(desktopPaper, "main.tex"), "utf8"), remoteText);
console.log(JSON.stringify({ synthetic: true, remoteMachineUsed: false, workspace, desktopHome, distinctDataHomes: true, firstCopyPreservedIdentity: true, offlineToolsFromDataHome: true, projectId: project.id, planId: compared.planId, proposalId: proposal.id, folder: prepared.folder, brief,
  sourceVariantsCombined: true, notesPreserved: true, existingCatalogueUnchangedByNotebookCollection: true, experimentNotebookCollected: true, collectionId: collected.collectionId, backupPath: collected.backupPath,
  reverseConversationCollected: true, desktopExistingConversationsPreserved: true, conversationCollectionId: conversationCollected.collectionId, conversationBackupPath: conversationCollected.backupPath,
  wholeProjectImported: false, codeExecuted: false, approvalGranted: false, commands }, null, 2));
