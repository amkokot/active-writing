// Prepare a new read-only sharing snapshot. Never publishes or rewrites live work.
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { getProject, parseProject } from "../server/projects.ts";
import { readNotebook } from "../server/notebookStore.ts";
import { collaboratorExport } from "../server/collaboratorExport.ts";
import { repositoryLink } from "../server/readerPages.ts";
import { sourceEntries } from "../server/sourceZip.ts";
import { loadReader } from "../server/shareReader.ts";

const args = process.argv.slice(2), flags = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--help") { console.log("awShare.ts --workspace AW_HOME --project ID --main CURRENT.tex --overview OVERVIEW.tex --repository https://github.com/OWNER/REPO --output NEW_FOLDER\nCreates an overview/research-note reader and explicit ordinary source list. No notebooks, cloud calls, Git writes, source changes, code execution or credentials. Prints the saved source/notebook revisions. Output must be new; inspect before publishing."); process.exit(0); }
  if (!["--workspace", "--project", "--main", "--overview", "--repository", "--output"].includes(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Use --help for explicit sharing scope.");
  flags.set(args[i], args[++i]);
}
const required = (flag: string) => { const value = flags.get(flag); if (!value) throw new Error(`${flag} is required.`); return value; };
const home = path.resolve(required("--workspace")), id = required("--project"), main = required("--main"), overview = required("--overview"), repo = repositoryLink(required("--repository"))!;
const output = path.resolve(required("--output"));
try { await lstat(output); throw new Error("Choose a new absent output folder. Nothing is overwritten."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const document = await parseProject(home, id), notebook = await readNotebook(home, id);
if (document.project.mainFile !== main) throw new Error("The project-wide selected manuscript differs from --main. Nothing is switched.");
const summary = await parseProject(home, id, false, overview);
if (document.project.manuscriptPurposes?.[overview] !== "overview" || document.structureIssue || summary.structureIssue) throw new Error("Choose a parseable saved Overview and research manuscript.");
const sources = await sourceEntries(home, id), sourceMap = new Map(sources.map(file => [file.name, file.data]));
const selected = new Set([...document.sourceFiles ?? [], ...summary.sourceFiles ?? []]);
for (const doc of [document, summary]) for (const [file, text] of Object.entries(doc.sources)) {
  if (/\\(?:import|subimport|subfile|includegraphics\*)\b/.test(text)) throw new Error("Unsupported resource loader: inspect and select the source dependencies manually.");
  for (const match of text.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^{}]+)\}|\\(?:bibliography|addbibresource)\{([^{}]+)\}/g)) {
    for (const raw of (match[1] ?? match[2]).split(",")) {
      const name = path.posix.normalize(raw.trim().replaceAll("\\", "/")), candidates = [name, path.posix.join(path.posix.dirname(file), name)].flatMap(base => [base, ...["png", "jpg", "jpeg", "webp", "gif", "pdf", "bib"].map(ext => `${base}.${ext}`)]);
      const found = candidates.find(candidate => sourceMap.has(candidate)); if (!found) throw new Error(`Missing selected resource: ${name}`); selected.add(found);
    }
  }
}
for (const name of selected) if (!sourceMap.has(name) || !/\.(tex|bib|png|jpe?g|webp|gif|pdf)$/.test(name)) throw new Error(`Inspect unsupported source dependency: ${name}`);
const exported = await collaboratorExport(home, { projectId: id, mainFile: main, revision: document.revision, notebookRevision: notebook.revision, format: "web", overviewFile: overview, includeNotebook: false, repositoryUrl: repo });
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); const repository = path.join(output, "repository"); await mkdir(repository);
let offset = 0;
while (exported.data.readUInt32LE(offset) === 0x04034b50) {
  const size = exported.data.readUInt32LE(offset + 18), length = exported.data.readUInt16LE(offset + 26), extra = exported.data.readUInt16LE(offset + 28), name = exported.data.subarray(offset + 30, offset + 30 + length).toString();
  if (!/^aw\/(?:[\w.-]+\/)*[\w.-]+$/.test(name) || name.split("/").some(p => p.startsWith("."))) throw new Error("Unexpected exported path; preparation kept for inspection.");
  const bytes = inflateRawSync(exported.data.subarray(offset + 30 + length + extra, offset + 30 + length + extra + size)), file = path.join(repository, name);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes, { flag: "wx" }); offset += 30 + length + extra + size;
}
for (const name of selected) { const target = path.join(repository, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, sourceMap.get(name)!, { flag: "wx" }); }
await writeFile(path.join(output, "reader.zip"), exported.data, { flag: "wx" });
const files = await loadReader(path.join(repository, "aw"));
const latest = await parseProject(home, id);
if (latest.revision !== document.revision || latest.project.mainFile !== main || (await readNotebook(home, id)).revision !== notebook.revision) throw new Error("Saved work changed during preparation. The partial snapshot is retained; do not publish it.");
const report = { version: 1, projectId: id, repository: repo, main, overview, sourceRevision: document.revision, notebookRevision: notebook.revision, sourceFiles: [...selected].sort(), readerFiles: [...files.keys()].filter(name => name !== "reader.zip"), sourceHashes: Object.fromEntries([...selected].map(name => [name, createHash("sha256").update(sourceMap.get(name)!).digest("hex")])), notebooksIncluded: false, published: false };
await writeFile(path.join(output, "preparation.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ ...report, output, repositoryFolder: repository, paperRoot: (await getProject(home, id)).root, readerFolder: path.join(repository, "aw") }, null, 2));
