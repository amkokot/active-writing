import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rename, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { desktopInputs, desktopBuildReady, writeDesktopBuildStamp } from "./desktopBuild.mjs";
import { desktopServer } from "./desktopServer.mjs";
import { serverArguments } from "./desktopLauncher.mjs";
import { registerProject, parseProject } from "../server/projects.ts";

test("frontend rebuilds retain hashed chunks needed by already-open editor tabs", async () => {
  const config = await readFile("vite.config.ts", "utf8");
  assert.match(config, /build:\s*\{\s*emptyOutDir:\s*false\s*\}/);
});

async function fixture() {
  const base = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "desktop-startup-"));
  await Promise.all(["dist/assets", "src", "paper"].map(dir => mkdir(path.join(root, dir), { recursive: true })));
  await writeFile(path.join(root, "src/main.ts"), "App source");
  await writeFile(path.join(root, "index.html"), "App HTML source");
  await writeFile(path.join(root, "dist/index.html"), '<script type="module" src="/assets/app-Abcd1234.js"></script>');
  await writeFile(path.join(root, "dist/assets/app-Abcd1234.js"), "Built script");
  await writeFile(path.join(root, "dist/assets/font-Abcd1234.woff2"), "Font bytes");
  return root;
}
test("desktop build freshness notices changes, added files and removed files, not manuscript edits", async () => {
  const root = await fixture();
  assert.equal(await desktopBuildReady(root), false);
  await writeDesktopBuildStamp(root); assert.equal(await desktopBuildReady(root), true);
  await writeFile(path.join(root, "paper/note.tex"), "User manuscript"); assert.equal(await desktopBuildReady(root), true);
  await writeFile(path.join(root, "src/main.ts"), "Changed app source"); assert.equal(await desktopBuildReady(root), false);
  await writeDesktopBuildStamp(root); await writeFile(path.join(root, "src/new.ts"), "Added"); assert.equal(await desktopBuildReady(root), false);
  await writeDesktopBuildStamp(root); await rename(path.join(root, "src/new.ts"), path.join(root, "paper/moved.ts")); assert.equal(await desktopBuildReady(root), false);
  await writeDesktopBuildStamp(root); const inputs = await desktopInputs(root);
  await writeFile(path.join(root, "src/main.ts"), "Edited during build");
  await assert.rejects(writeDesktopBuildStamp(root, path.join(root, "dist"), inputs), /changed during/);
  assert.equal(await desktopBuildReady(root), false);
});
test("shortcut chooses the built server only for a current build and keeps development fallback", async () => {
  const root = await fixture();
  let choice = await serverArguments(root); assert.equal(choice.built, false); assert.ok(choice.args.includes("--strictPort"));
  await writeDesktopBuildStamp(root); choice = await serverArguments(root); assert.equal(choice.built, true);
  assert.deepEqual(choice.args, [path.join(root, "scripts/desktopServer.mjs")]);
  const source = path.join(root, "src/main.ts"), previous = await stat(source);
  await writeFile(source, "Changed UI");
  // Same-length fast fixture writes can share a filesystem timestamp quantum.
  // The freshness contract observes size/mtime, so make this edit observable.
  await utimes(source, previous.atime, new Date(previous.mtimeMs + 1000));
  assert.equal((await serverArguments(root)).built, false);
});
test("separate research data requires a current build and is passed explicitly to the server", async () => {
  const root = await fixture(), home = path.join(root, "research-home"); await mkdir(home);
  await assert.rejects(() => serverArguments(root, home), /current app build/);
  await writeDesktopBuildStamp(root);
  assert.deepEqual((await serverArguments(root, home)).args, [path.join(root, "scripts/desktopServer.mjs"), "--workspace", home]);
});
test("built server serves the same editor API, source saves and sidecars without development compilation", async t => {
  const root = await fixture();
  await writeFile(path.join(root, "paper/main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Trial}\nFirst passage.\n\nSecond passage.\n\\end{document}\n");
  const project = await registerProject(root, "paper", "Startup trial");
  const server = desktopServer(root, path.join(root, "dist"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`, request = async (route, options) => fetch(url + route, options);
  assert.equal((await (await request("/api/paperfocus/health")).json()).workspaceRoot, root);
  assert.equal((await (await request("/api/paperfocus/health")).json()).codeRoot, path.resolve("."));
  const html = await request("/?panel=notebook"); assert.match(await html.text(), /app-Abcd1234.js/);
  assert.equal(html.headers.get("cache-control"), "no-cache");
  const asset = await request("/assets/app-Abcd1234.js"); assert.match(asset.headers.get("cache-control"), /immutable/); assert.match(asset.headers.get("content-type"), /javascript/);
  const head = await request("/assets/font-Abcd1234.woff2", { method: "HEAD" }); assert.equal(head.headers.get("content-type"), "font/woff2"); assert.equal(await head.text(), "");
  for (const route of ["/.aw-build.json", "/src/main.ts", "/assets/%2e%2e%5csrc%5cmain.ts", "/missing.js"]) assert.equal((await request(route)).status, 404);
  assert.equal((await request("/api/missing")).status, 404);
  const withHost = host => new Promise((resolve, reject) => { const req = httpRequest(url + "/api/paperfocus/health", { headers: { Host: host } }, res => { res.resume(); resolve(res.statusCode); }); req.on("error", reject); req.end(); });
  assert.equal(await withHost("unrelated.example"), 403);
  assert.equal(await withHost("localhost:1"), 403);
  const parsed = await (await request(`/api/paperfocus/document?projectId=${project.id}`)).json();
  assert.equal(parsed.paragraphs[0].text, "First passage.");
  const options = body => ({ method: "POST", headers: { "Content-Type": "application/json", Origin: url }, body: JSON.stringify(body) });
  const result = await request("/api/paperfocus/document", options({ projectId: project.id, revision: parsed.revision, paragraphEdits: { [parsed.paragraphs[0].id]: "Revised passage." } }));
  assert.equal(result.status, 200); assert.equal((await parseProject(root, project.id)).paragraphs[0].text, "Revised passage.");
  const notebook = await request("/api/paperfocus/notebook", options({ projectId: project.id, revision: 0, entries: [] })); assert.equal(notebook.status, 200);
  const workbench = await request("/api/paperfocus/workbench", options({ projectId: project.id, revision: 0, data: { attentionTasks: [], rewriteSessions: [], handoffDrafts: {}, recoveredDrafts: [] } })); assert.equal(workbench.status, 200);
  const forbidden = await request("/api/paperfocus/document", { ...options({}), headers: { "Content-Type": "application/json", Origin: "https://unrelated.example" } }); assert.equal(forbidden.status, 403);
  assert.match(await readFile(path.join(root, "paper/main.tex"), "utf8"), /Second passage/);
});
