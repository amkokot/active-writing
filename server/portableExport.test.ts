import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rename, symlink } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { portableEntries, portableZip } from "./portableExport.ts";
import { verifyDistribution } from "../scripts/portableSetup.mjs";
import { latexMiddleware } from "./latexPlugin.ts";
import { parseProject } from "./projects.ts";
import { seedWelcome } from "../scripts/seedWelcome.mjs";
import { readNotebook } from "./notebookStore.ts";
import { readExperiments } from "./experiments.ts";
import { preparePublicAw } from "../scripts/preparePublicAw.mjs";

const appRoot = process.cwd();
let base: Awaited<ReturnType<typeof portableEntries>>;
async function files() { return base ??= await portableEntries(appRoot); }
async function fixture() {
  const parent = path.join(appRoot, ".paperfocus", "trials"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "portable-aw-"));
  for (const entry of (await files()).entries) {
    const target = path.join(root, entry.name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, entry.data);
  }
  return root;
}
function unzip(data: Buffer) {
  const entries = new Map<string, Buffer>(); let offset = 0;
  while (data.readUInt32LE(offset) === 0x04034b50) {
    const compressed = data.readUInt32LE(offset + 18), length = data.readUInt16LE(offset + 26);
    const name = data.subarray(offset + 30, offset + 30 + length).toString();
    assert.ok(!entries.has(name));
    entries.set(name, inflateRawSync(data.subarray(offset + 30 + length, offset + 30 + length + compressed)));
    offset += 30 + length + compressed;
  }
  return entries;
}

test("clean app package includes instructions/tools and a new example, not private workspace or development history", async () => {
  const { entries, manifest } = await files(), names = entries.map(entry => entry.name);
  for (const name of ["AGENTS.md", "docs/AGENT_GUIDE.md", "docs/RESEARCH_WORKFLOW.md", "scripts/awResearch.ts", "scripts/awOffline.ts", "scripts/awWriting.ts", "scripts/awVersions.ts", "server/experiment_runner.py", "scripts/research-requirements.txt", "Set up Aw.cmd", "Start Aw.cmd", "aw-distribution.json"]) assert.ok(names.includes(name), name);
  assert.equal(manifest.privateWorkspaceIncluded, false);
  assert.ok(names.every(name => !/^(?:\.paperfocus|\.codex|node_modules|dist|papers|output|tmp|problem-lab)\//.test(name)));
  assert.equal(entries.find(entry => entry.name === "README.md")!.data.toString(), await readFile("distribution/README.md", "utf8"));
  assert.match(entries.find(entry => entry.name === "demo-paper/main.tex")!.data.toString(), /fresh example, not the sender's research/);
  assert.ok(!JSON.stringify(manifest).includes(appRoot));
  const archive = unzip(await portableZip(appRoot));
  assert.equal(archive.size, entries.length);
  assert.deepEqual(archive.get("scripts/awOffline.ts"), entries.find(entry => entry.name === "scripts/awOffline.ts")!.data);
});

test("strict app allowlist excludes private decoys even in an otherwise valid installation", async () => {
  const root = await fixture(), sentinel = `private-${randomUUID()}`;
  for (const name of [".paperfocus/projects.json", ".paperfocus/project-data/private/notebook.json", ".codex/auth.json", "papers/secret.tex", "src/.env", "scripts/private-research.py", "docs/PRIVATE.md", "demo-paper/main.tex", "README.md"]) {
    const target = path.join(root, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, sentinel);
  }
  const result = await portableEntries(root);
  assert.ok(result.entries.every(entry => !entry.data.includes(Buffer.from(sentinel))));
  assert.equal(await readFile(path.join(root, ".paperfocus/projects.json"), "utf8"), sentinel);
});

test("public tree is complete, has no personal hosting context, and re-exports without private files", async () => {
  const root = await fixture(), result = await portableEntries(root), names = new Set(result.entries.map(e => e.name));
  for (const file of ["LICENSE", ".gitignore", ".gitattributes", "docs/GETTING_STARTED.md", "demo-paper/sections/proof.tex", "deploy/cloudflare-reader/reader/worker.js", "deploy/cloudflare-reader/reader/schema.sql", "scripts/awShare.ts", "scripts/seedWelcome.mjs"]) assert.ok(names.has(file), file);
  assert.equal(result.entries.find(e => e.name === "docs/ONLINE_SHARING.md")!.data.toString(), await readFile("distribution/ONLINE_SHARING.md", "utf8"));
  assert.ok(![...names].some(name => name.startsWith("sites/") || name.startsWith("scripts/fixtures/")));
  const pkg = JSON.parse((await readFile(path.join(root, "package.json"))).toString());
  for (const [name, command] of Object.entries(pkg.scripts) as [string, string][]) if (name === "test" || name.startsWith("test:")) for (const file of command.replace("node --test ", "").split(/\s+/)) assert.ok(names.has(file), `missing runnable test ${file}`);
  const output = path.join(root, "clean-copy"); await preparePublicAw(root, output); await verifyDistribution(output);
  await assert.rejects(preparePublicAw(root, output), /EEXIST/);
});

test("welcome setup adds an unrun linked notebook once and never resets a user's work", async () => {
  const root = await fixture(); assert.equal((await seedWelcome(root)).seeded, true);
  const document = await parseProject(root); assert.equal(document.project.name, "Welcome to Aw");
  assert.equal(document.project.manuscriptOverviewTargets?.["overview.tex"], "main.tex");
  assert.ok(document.paragraphs.some(p => p.file === "sections/result.tex"));
  const notes = await readNotebook(root, "demo"); assert.equal(notes.entries.length, 1); assert.ok(notes.entries[0].source);
  const store = await readExperiments(root, "demo", "welcome-series"); assert.equal(store.notebook.cells.length, 3);
  const code = store.notebook.cells.find(c => c.cell_type === "code")!; assert.equal(code.execution_count, null); assert.deepEqual(code.outputs, []);
  const before = await readFile(path.join(root, ".paperfocus/projects.json"));
  assert.equal((await seedWelcome(root)).seeded, false); assert.deepEqual(await readFile(path.join(root, ".paperfocus/projects.json")), before);
  const changed = await fixture(); await writeFile(path.join(changed, "demo-paper/main.tex"), "A person's own example");
  assert.equal((await seedWelcome(changed)).seeded, false); assert.equal(await readFile(path.join(changed, "demo-paper/main.tex"), "utf8"), "A person's own example");
});

test("extracted package verifies, opens its fresh paper and supports offline agent help without npm setup", async () => {
  const root = await fixture(), result = await verifyDistribution(root);
  assert.equal(result.files, (await files()).manifest.files.length);
  const paper = await parseProject(root);
  assert.ok(paper.nodes.length >= 3);
  assert.match(paper.body, /fresh example/);
  const exec = promisify(execFile);
  const help = await exec(process.execPath, [path.join(root, "scripts/awResearch.ts"), "--help"], { cwd: root, windowsHide: true });
  assert.match(help.stdout, /offline/);
  const verification = await exec(process.execPath, [path.join(root, "scripts/portableSetup.mjs"), "--verify"], { cwd: root, windowsHide: true });
  assert.match(verification.stdout, /Verified/);
});

test("recipient verification rejects changed files and unsafe/duplicate manifest paths", async () => {
  const root = await fixture(), original = await readFile(path.join(root, "AGENTS.md"));
  await writeFile(path.join(root, "AGENTS.md"), "changed");
  await assert.rejects(() => verifyDistribution(root), /changed or incomplete/);
  await writeFile(path.join(root, "AGENTS.md"), original);
  const manifestPath = path.join(root, "aw-distribution.json"), originalManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const name of ["../outside", "C:/auth.json", "src\\auth.json", "src/../auth.json", "/absolute"]) {
    const manifest = structuredClone(originalManifest); manifest.files[0].path = name; await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(() => verifyDistribution(root), /Unsafe/);
  }
  const duplicate = structuredClone(originalManifest); duplicate.files.push(duplicate.files[0]); await writeFile(manifestPath, JSON.stringify(duplicate));
  await assert.rejects(() => verifyDistribution(root), /Unsafe/);
});

test("export refuses linked app directories and oversized app files without following them", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "src/oversized.ts"), Buffer.alloc(8 * 1024 * 1024 + 1));
  await assert.rejects(() => portableEntries(root), /limited to/);
  const linked = await fixture(), original = path.join(linked, "src"), replacement = path.join(linked, "source-original");
  await rename(original, replacement); await symlink(replacement, original, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => portableEntries(linked), /linked/);
  await assert.rejects(() => verifyDistribution(linked), /linked/);
});

test("offline exporter never replaces an existing destination", async () => {
  const root = await fixture(), output = path.join(root, "existing.zip"); await writeFile(output, "KEEP");
  const exec = promisify(execFile);
  await assert.rejects(() => exec(process.execPath, [path.join(root, "scripts/exportAw.mjs"), "--output", output], { cwd: root, windowsHide: true }), /EEXIST/);
  assert.equal(await readFile(output, "utf8"), "KEEP");
});

test("app download requires explicit same-origin POST and exports code, never the selected workspace", async () => {
  const isolated = await fixture(), middleware = latexMiddleware(isolated), sentinel = `private-${randomUUID()}`;
  await mkdir(path.join(isolated, ".paperfocus"), { recursive: true });
  await writeFile(path.join(isolated, ".paperfocus/projects.json"), sentinel);
  const server = createServer((req, res) => { void middleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`, url = `${origin}/api/paperfocus/export-aw.zip`;
  try {
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await fetch(url, { method: "POST" })).status, 403);
    assert.equal((await fetch(url, { method: "POST", headers: { Origin: "https://foreign.example" } })).status, 403);
    const response = await fetch(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Type"), "application/zip");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const archive = unzip(Buffer.from(await response.arrayBuffer()));
    assert.ok([...archive.values()].every(data => !data.includes(Buffer.from(sentinel))));
    assert.ok(archive.has("AGENTS.md"));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
