import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, appendFileSync, readFileSync, writeFileSync, unlinkSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { desktopBuildReady } from "./desktopBuild.mjs";

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const appUrl = "http://127.0.0.1:4173/";
// API health alone can succeed while Vite serves stale React dependencies.
// Diagnose that case without restarting an occupied service or clearing caches.
export async function checkFrontend(url = appUrl) {
  const read = async (relative) => {
    const target = new URL(relative, url);
    if (target.origin !== new URL(url).origin) throw new Error("Unexpected startup asset origin.");
    const response = await fetch(target, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) throw new Error(`Aw's page could not load (${response.status}). The local server may need a safe restart; save drafts and finish active jobs first.`);
    return response.text();
  };
  const html = await read("/");
  if (!html.includes('/@vite/client')) return; // Built assets do not use Vite's dependency cache.
  const main = await read("/src/main.tsx");
  const dependencies = [...new Set(main.match(/\/node_modules\/\.vite\/deps\/[^"'\s]+/g) ?? [])];
  await Promise.all(dependencies.map(read));
}
const launcherFolder = (workspace = appRoot) => path.join(workspace, ".paperfocus", "launcher");

function logLauncher(message, workspace = appRoot) {
  const launcherDirectory = launcherFolder(workspace);
  mkdirSync(launcherDirectory, { recursive: true });
  appendFileSync(path.join(launcherDirectory, "launcher.log"), `${new Date().toISOString()} [${process.pid}] ${message}\n`);
}
export function launcherOptions(args = []) {
  const options = { browser: true, workspace: appRoot };
  let specified = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--no-browser") options.browser = false;
    else if (args[index] === "--workspace" && !specified && args[index + 1] && !args[index + 1].startsWith("--")) { options.workspace = path.resolve(args[++index]); specified = true; }
    else throw new Error("Use --workspace DATA_HOME and/or --no-browser. No service was changed.");
  }
  return options;
}
export function validateLaunchWorkspace(workspace = appRoot) {
  const stat = lstatSync(workspace);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Choose an existing, ordinary research-data home.");
  const home = realpathSync(workspace), journal = path.join(home, ".paperfocus/device-sync/clone.json");
  const readyPath = path.join(home, ".paperfocus/device-sync/clone-ready.json");
  for (const folder of [path.join(home, ".paperfocus"), path.join(home, ".paperfocus/device-sync")]) {
    if (existsSync(folder) && (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink())) throw new Error("Research-data and transfer folders cannot be linked paths.");
  }
  if (existsSync(readyPath) && !existsSync(journal)) throw new Error("First-copy receipt has no owning journal. No service was changed.");
  if (existsSync(journal)) {
    if (!existsSync(readyPath)) throw new Error("This first copy is unfinished. Resume the exact awSync clone before opening it; no server was started.");
    if ([journal, readyPath].some(file => !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || lstatSync(file).size > 10000)) throw new Error("Invalid first-copy receipt.");
    const pending = JSON.parse(readFileSync(journal, "utf8")), ready = JSON.parse(readFileSync(readyPath, "utf8"));
    if (pending?.version !== 1 || pending.format !== "aw-first-copy" || ready?.version !== 1 || ![pending.planId, pending.snapshotId].every(id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))
      || typeof pending.projectId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(pending.projectId)
      || pending.planId !== ready.planId || pending.snapshotId !== ready.snapshotId || pending.projectId !== ready.projectId) throw new Error("First-copy identity/receipt mismatch. No service was changed.");
  }
  return home;
}

export function isMainModule(argument, modulePath, platform = process.platform) {
  if (!argument) return false;
  const resolved = path.resolve(argument);
  return platform === "win32" ? resolved.toLowerCase() === modulePath.toLowerCase() : resolved === modulePath;
}

export function matchesWorkspace(health, root = appRoot) {
  return health?.app === "active-writing" && typeof health.workspaceRoot === "string"
    && path.resolve(health.workspaceRoot).toLowerCase() === path.resolve(root).toLowerCase();
}

export async function serverState(url = appUrl, root = appRoot) {
  try {
    const response = await fetch(new URL("api/paperfocus/health", url), {
      signal: AbortSignal.timeout(1500), redirect: "error", headers: { Connection: "close" },
    });
    let health;
    try { health = await response.json(); } catch { return "other"; }
    return response.ok && matchesWorkspace(health, root) ? "ready" : "other";
  } catch (error) {
    // A timeout is not evidence that a listening port is free.
    return error.cause?.code === "ECONNREFUSED" ? "offline" : "other";
  }
}

export function runWindowsCommand(command, spawnProcess = spawn) {
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", chunk => { stderr = (stderr + chunk).slice(-12000); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error("The browser-opening command timed out.")); }, 15000);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(stderr.trim() || `Browser opening failed (exit ${code}).`));
      else resolve();
    });
  });
}

export async function openBrowser(run = runWindowsCommand, workspace = appRoot) {
  logLauncher(`Opening browser: ${appUrl}`, workspace);
  // The launcher console is hidden, but the browser must not inherit a hidden window state.
  await run(`$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${appUrl}' -WindowStyle Normal -ErrorAction Stop`);
  logLauncher("Browser-opening command completed.", workspace);
}

function showError(error, workspace = appRoot) {
  const message = `Active Writing could not start.\n\n${error.message}\n\nDetails: ${path.join(launcherFolder(workspace), "launcher.log")}`;
  try { logLauncher(error.stack ?? String(error), workspace); } catch { /* report errors even when the log cannot be written */ }
  console.error(message);
  if (!process.argv.includes("--no-browser")) {
    const quoted = message.replaceAll("'", "''");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${quoted}', 'Active Writing', 'OK', 'Error') | Out-Null`],
    { windowsHide: true, detached: true, stdio: "ignore" });
    child.unref();
  }
}

async function waitForServer(server, workspace = appRoot) {
  let otherResponses = 0;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server?.exitCode != null) throw new Error("The local server stopped during startup. See server.stderr.log in .paperfocus/launcher.");
    const state = await serverState(appUrl, workspace);
    if (state === "ready") return;
    // A briefly busy/restarting Vite server is not necessarily an unrelated app.
    otherResponses = state === "other" ? otherResponses + 1 : 0;
    if (otherResponses >= 3) throw new Error("Port 4173 is busy or not responding as this copy of Active Writing. Close the other local server and try again. Nothing was stopped.");
    await delay(500);
  }
  throw new Error("Startup took longer than expected. Try the shortcut again; the local server may still be starting. See server.stderr.log in .paperfocus/launcher.");
}

export async function serverArguments(root = appRoot, workspace = root) {
  const built = await desktopBuildReady(root);
  const separate = path.resolve(workspace) !== path.resolve(root);
  if (separate && !built) throw new Error("A separate data home needs a current app build. Build the app code first; no development server was started on the wrong workspace.");
  return { built, args: built ? [path.join(root, "scripts", "desktopServer.mjs"), ...(separate ? ["--workspace", path.resolve(workspace)] : [])] : [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "4173", "--strictPort"] };
}

export async function launch({ browser = true, workspace = appRoot } = {}) {
  workspace = validateLaunchWorkspace(workspace);
  const launcherDirectory = launcherFolder(workspace);
  mkdirSync(launcherDirectory, { recursive: true });
  logLauncher(`Launch requested${browser ? "" : " (server check only)"}.`, workspace);
  const state = await serverState(appUrl, workspace);
  if (state === "other") await waitForServer(undefined, workspace);
  if (state === "ready" || state === "other") {
    await checkFrontend();
    logLauncher("Reusing the matching local server.", workspace);
    if (browser) await openBrowser(undefined, workspace);
    return "reused";
  }
  const vite = path.join(appRoot, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(vite)) throw new Error("App dependencies are missing. Run npm install in the Active Writing folder first.");
  const lockFile = path.join(launcherDirectory, "start.lock");
  let lock;
  try { lock = openSync(lockFile, "wx"); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner;
    try { owner = Number(readFileSync(lockFile, "utf8")); } catch { /* another launcher is creating the lock */ }
    if (Number.isSafeInteger(owner) && owner > 0) {
      try { process.kill(owner, 0); } catch (probe) {
        if (probe.code === "ESRCH") { unlinkSync(lockFile); return launch({ browser, workspace }); }
      }
    }
    await waitForServer(undefined, workspace);
    await checkFrontend();
    if (browser) await openBrowser(undefined, workspace);
    return "reused";
  }
  try {
    writeFileSync(lock, String(process.pid));
    const stdout = openSync(path.join(launcherDirectory, "server.stdout.log"), "a");
    const stderr = openSync(path.join(launcherDirectory, "server.stderr.log"), "a");
    let server;
    try {
      const { built, args } = await serverArguments(appRoot, workspace);
      logLauncher(built ? "Starting the prebuilt app (no development compilation)." : "Build missing or out of date; using the development server. Run npm run build to enable fast startup.", workspace);
      server = spawn(process.execPath, args, {
        cwd: appRoot, windowsHide: true, detached: true, stdio: ["ignore", stdout, stderr],
      });
    } finally { closeSync(stdout); closeSync(stderr); }
    let spawnError;
    server.on("error", (error) => { spawnError = error; });
    server.unref();
    if (server.pid) writeFileSync(path.join(launcherDirectory, "server.pid"), String(server.pid));
    await waitForServer(server, workspace);
    await checkFrontend();
    if (spawnError) throw spawnError;
    if (browser) await openBrowser(undefined, workspace);
    return "started";
  } finally {
    closeSync(lock);
    unlinkSync(lockFile);
  }
}

if (isMainModule(process.argv[1], fileURLToPath(import.meta.url))) {
  let options;
  try { options = launcherOptions(process.argv.slice(2)); } catch (error) { showError(error); process.exitCode = 1; }
  if (options) launch(options)
    .then((result) => console.log(`Active Writing: ${result} ${appUrl}`))
    .catch((error) => { showError(error, options.workspace); process.exitCode = 1; });
}
