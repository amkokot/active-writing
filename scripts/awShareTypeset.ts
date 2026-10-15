// Typeset only the prepared ordinary source in an isolated new data home.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createPaperProject } from "../server/projectFiles.ts";
import { registry, saveRegistry, parseProject } from "../server/projects.ts";
import { projectBuildFolder } from "../server/projectStorage.ts";
import { compile } from "../server/latexPlugin.ts";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--preparation") throw new Error("Use --preparation EXPLICIT_NEW_SHARING_FOLDER.");
const prepared = path.resolve(args[1]), report = JSON.parse(await readFile(path.join(prepared, "preparation.json"), "utf8"));
if (report.version !== 1 || report.published || report.notebooksIncluded || !Array.isArray(report.sourceFiles) || report.sourceFiles.length > 100) throw new Error("Choose an inspected, unpublished reading-only preparation.");
const sources = await Promise.all(report.sourceFiles.map(async (name: string) => {
  if (!/^(?:[\w.-]+\/)*[\w.-]+$/.test(name) || name.split("/").some(p => p.startsWith("."))) throw new Error("Invalid prepared source path.");
  const data = await readFile(path.join(prepared, "repository", name));
  if (createHash("sha256").update(data).digest("hex") !== report.sourceHashes[name]) throw new Error("Prepared source changed.");
  return { path: name, data: data.toString("base64") };
}));
// Keep the isolated TeX paths short enough for Windows latexmk/auxiliary files.
const home = await mkdtemp(path.join(os.tmpdir(), "aw-share-tex-"));
const project = await createPaperProject(home, "Shared research note - typeset snapshot", sources);
const reg = await registry(home); reg.activeId = project.id; reg.projects.find(p => p.id === project.id)!.mainFile = report.main; await saveRegistry(home, reg);
const document = await parseProject(home, project.id), result = await compile(home, { projectId: project.id, revision: document.revision, mode: "full" });
if (!result.success) throw new Error(`Snapshot typesetting failed: ${result.log}`);
const pdf = path.join(await projectBuildFolder(home, project.id, "full"), path.basename(report.main, ".tex") + ".pdf");
await writeFile(path.join(prepared, "typeset-result.json"), JSON.stringify({ pdf, sourceHashes: report.sourceHashes, success: true, diagnostics: result.diagnostics, durationMs: result.durationMs }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ pdf, success: true, diagnostics: result.diagnostics?.map(d => d.title), durationMs: result.durationMs, originalWorkspaceUntouched: true }));
