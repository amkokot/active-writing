import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import test from "node:test";
import { mkdir, mkdtemp, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { appRoot, matchesWorkspace, serverState, checkFrontend, isMainModule, openBrowser, runWindowsCommand, launcherOptions, validateLaunchWorkspace } from "./desktopLauncher.mjs";

test("launcher detects stale development dependencies even when API health succeeds", async t => {
  let stale = true, built = false;
  const requests = [];
  const server = createServer((request, reply) => {
    requests.push(request.url);
    if (request.url === "/") reply.end(built ? '<script src="/assets/app.js"></script>' : '<script src="/@vite/client"></script>');
    else if (request.url === "/src/main.tsx") reply.end('import React from "/node_modules/.vite/deps/react.js?v=old";');
    else if (request.url.startsWith("/node_modules/.vite/deps/")) { reply.statusCode = stale ? 504 : 200; reply.end("dependency"); }
    else { reply.statusCode = 404; reply.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/`;
  await assert.rejects(checkFrontend(url), /504.*safe restart/);
  stale = false; await checkFrontend(url);
  built = true; requests.length = 0; await checkFrontend(url);
  assert.deepEqual(requests, ["/"], "built startup never requests development dependencies");
});

test("launcher accepts an explicit data home without changing the default shortcut", () => {
  assert.deepEqual(launcherOptions([]), { workspace: appRoot, browser: true });
  assert.deepEqual(launcherOptions(["--no-browser", "--workspace", "Research home"]), { workspace: path.resolve("Research home"), browser: false });
  for (const args of [["--workspace"], ["--workspace", "--no-browser"], ["--workspace", "a", "--workspace", "b"], ["--wrong"]]) assert.throws(() => launcherOptions(args), /No service was changed/);
  assert.equal(matchesWorkspace({ app: "active-writing", workspaceRoot: "C:/different-data" }, "C:/different-data"), true);
  assert.equal(matchesWorkspace({ app: "active-writing", workspaceRoot: appRoot }, "C:/different-data"), false);
});

test("launcher refuses incomplete, damaged and linked transfer homes without starting anything", async () => {
  const parent = path.join(appRoot, ".paperfocus/trials"); await mkdir(parent, { recursive: true });
  const home = await mkdtemp(path.join(parent, "launch-copy-")); assert.equal(validateLaunchWorkspace(home).toLowerCase(), home.toLowerCase());
  const sync = path.join(home, ".paperfocus/device-sync"); await mkdir(sync, { recursive: true });
  const journal = { version: 1, format: "aw-first-copy", planId: "a".repeat(64), snapshotId: "b".repeat(64), projectId: "project" };
  await writeFile(path.join(sync, "clone.json"), JSON.stringify(journal)); assert.throws(() => validateLaunchWorkspace(home), /unfinished/);
  await writeFile(path.join(sync, "clone-ready.json"), JSON.stringify({ ...journal, projectId: "another" })); assert.throws(() => validateLaunchWorkspace(home), /mismatch/);
  await writeFile(path.join(sync, "clone-ready.json"), JSON.stringify(journal)); assert.equal(validateLaunchWorkspace(home).toLowerCase(), home.toLowerCase());
  const linkedHome = await mkdtemp(path.join(parent, "launch-linked-")); await symlink(path.join(home, ".paperfocus"), path.join(linkedHome, ".paperfocus"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => validateLaunchWorkspace(linkedHome), /linked paths/);
});

test("the Windows entry point handles shortcut path capitalization", () => {
  const script = `${appRoot}\\scripts\\desktopLauncher.mjs`;
  assert.equal(isMainModule(script.toUpperCase(), script, "win32"), true);
  assert.equal(isMainModule(undefined, script, "win32"), false);
  assert.equal(isMainModule(script.toUpperCase(), script, "linux"), false);
});

test("browser opening explicitly requests a normal window and waits for completion", async () => {
  let command;
  let complete;
  const running = openBrowser(value => { command = value; return new Promise(resolve => { complete = resolve; }); });
  assert.match(command, /-WindowStyle Normal/);
  assert.match(command, /-ErrorAction Stop/);
  let finished = false;
  running.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  complete();
  await running;
});

test("failed browser-opening commands are returned instead of silently discarded", async () => {
  const fakeSpawn = (executable, args, options) => {
    assert.match(executable, /WindowsPowerShell/);
    assert.equal(options.windowsHide, true);
    assert.equal(options.detached, undefined);
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    queueMicrotask(() => { child.stderr.emit("data", "The default browser could not be opened"); child.emit("close", 1); });
    return child;
  };
  await assert.rejects(runWindowsCommand("test", fakeSpawn), /default browser could not be opened/);
});

test("launcher recognizes only this app and this folder", () => {
  assert.equal(matchesWorkspace({ app: "active-writing", workspaceRoot: appRoot }), true);
  assert.equal(matchesWorkspace({ app: "active-writing", workspaceRoot: appRoot.toUpperCase() }), true);
  assert.equal(matchesWorkspace({ app: "another-app", workspaceRoot: appRoot }), false);
  assert.equal(matchesWorkspace({ app: "active-writing", workspaceRoot: `${appRoot}/different` }), false);
  assert.equal(matchesWorkspace({ app: "active-writing" }), false);
});

test("launcher distinguishes ready, unrelated, and stopped local servers", async (t) => {
  let response = JSON.stringify({ app: "active-writing", workspaceRoot: appRoot });
  let status = 200;
  const server = createServer((request, reply) => {
    assert.equal(request.url, "/api/paperfocus/health");
    reply.writeHead(status, { "Content-Type": "application/json" });
    reply.end(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/`;
  assert.equal(await serverState(url), "ready");
  assert.equal(await serverState(url, path.join(appRoot, "another-data-home")), "other");
  response = "<html>Different website</html>";
  assert.equal(await serverState(url), "other");
  response = JSON.stringify({ app: "active-writing", workspaceRoot: `${appRoot}/different` });
  assert.equal(await serverState(url), "other");
  response = JSON.stringify({ app: "active-writing", workspaceRoot: appRoot });
  status = 503;
  assert.equal(await serverState(url), "other");
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await serverState(url), "offline");
});
