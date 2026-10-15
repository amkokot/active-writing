import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { workspaceFolders, openWorkspaceFolder, selectedFolder } from "./workspaceFolders.ts";
import { workspaceNote } from "../src/workspaceFolders.ts";
import { registerProject } from "./projects.ts";
import { latexPlugin } from "./latexPlugin.ts";
import { appCodeRoot } from "./appPaths.ts";

async function fixture() {
  const base = path.resolve(".paperfocus/trials");
  await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "workspace-folders-"));
  const paper = path.join(workspace, "paper with spaces");
  await mkdir(paper);
  await writeFile(path.join(paper, "main.tex"), "\\documentclass{article}\n\\begin{document}Example.\\end{document}\n");
  const project = await registerProject(workspace, "paper with spaces", "Folder access test");
  return { workspace, paper, project };
}

test("folder information distinguishes app home from selected project without changing source", async () => {
  const f = await fixture();
  const before = await readFile(path.join(f.paper, "main.tex"), "utf8");
  const folders = await workspaceFolders(f.workspace, f.project.id);
  assert.equal(folders.home.path, await realpath(f.workspace));
  assert.equal(folders.paper?.path, await realpath(f.paper));
  assert.equal(folders.paper?.id, f.project.id);
  assert.equal(folders.data?.path, path.join(folders.home.path, ".paperfocus/project-data", f.project.id));
  assert.ok(workspaceNote(folders).includes(folders.data!.path));
  assert.match(workspaceNote(folders), /outside.*repository/);
  assert.match(folders.paper!.link, /paper%20with%20spaces\/$/);
  assert.equal(new URL(folders.home.link).protocol, "file:");
  assert.equal(folders.code?.path, appCodeRoot);
  assert.equal(folders.guidePath, path.join(appCodeRoot, "docs", "RESEARCH_WORKFLOW.md"));
  assert.ok(workspaceNote(folders).includes(appCodeRoot));
  assert.match(workspaceNote(folders), /explicit data home in --workspace/);
  assert.match(workspaceNote(folders), /Paper working folder:/);
  assert.ok(workspaceNote(folders).includes(f.paper));
  assert.equal(await readFile(path.join(f.paper, "main.tex"), "utf8"), before);
  assert.equal((await workspaceFolders(f.workspace)).paper, undefined);
  await assert.rejects(workspaceFolders(f.workspace, "not-registered"), /no longer registered/);
});

test("folder opening accepts only known home and paper targets, never arbitrary paths", async () => {
  const f = await fixture();
  const opened: string[] = [];
  const open = async (folder: string) => { opened.push(folder); };
  await openWorkspaceFolder(f.workspace, f.project.id, "paper", open);
  await openWorkspaceFolder(f.workspace, f.project.id, "home", open);
  await openWorkspaceFolder(f.workspace, f.project.id, "data", open);
  assert.deepEqual(opened, [await realpath(f.paper), await realpath(f.workspace), (await workspaceFolders(f.workspace, f.project.id)).data!.path]);
  await assert.rejects(openWorkspaceFolder(f.workspace, f.project.id, "../../outside", open), /Choose Aw home/);
  assert.equal(opened.length, 3);
  assert.throws(() => selectedFolder({ home: { path: f.workspace, link: "" }, guidePath: "", canOpen: false }, "paper"));
});

test("open-folder endpoint rejects missing and foreign origins before opening Explorer", async () => {
  const f = await fixture();
  let handler: any;
  (latexPlugin(f.workspace).configureServer as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  for (const origin of [undefined, "https://another-site.example"]) {
    const req = Object.assign(Readable.from([JSON.stringify({ projectId: f.project.id, target: "home" })]), {
      url: "/api/paperfocus/workspace-folders/open", method: "POST", headers: { host: "127.0.0.1:4173", ...(origin ? { origin } : {}) },
    });
    const res: any = { setHeader() {}, end(text: string) { res.body = JSON.parse(text); } };
    await handler(req, res, () => assert.fail("Unexpected fallthrough"));
    assert.equal(res.statusCode, 403);
  }
  const req = Object.assign(Readable.from([JSON.stringify({ projectId: f.project.id, target: "C:\\Windows", path: "C:\\Windows" })]), {
    url: "/api/paperfocus/workspace-folders/open", method: "POST", headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
  });
  const res: any = { setHeader() {}, end(text: string) { res.body = JSON.parse(text); } };
  await handler(req, res, () => assert.fail("Unexpected fallthrough"));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Choose Aw home/);
});
