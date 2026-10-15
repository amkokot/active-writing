import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inside = (base, target) => { const relative = path.relative(base, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };

export async function verifyDistribution(folder) {
  const base = await realpath(folder), manifestPath = path.join(base, "aw-distribution.json");
  const info = await lstat(manifestPath);
  if (info.isSymbolicLink() || !info.isFile() || info.size > 1024 * 1024) throw new Error("Invalid distribution manifest.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")), seen = new Set(); let total = 0;
  if (manifest.format !== "active-writing-distribution" || manifest.version !== 1 || manifest.privateWorkspaceIncluded !== false || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 2500) throw new Error("Not a supported clean Aw distribution.");
  for (const file of manifest.files) {
    if (typeof file.path !== "string" || !file.path || file.path.includes("\\") || file.path.includes(":") || file.path.includes("\0") || path.posix.isAbsolute(file.path) || file.path.split("/").some(p => !p || p === "." || p === "..") || seen.has(file.path.toLowerCase()) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 8 * 1024 * 1024 || (total += file.size) > 48 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Unsafe or oversized distribution entry.");
    seen.add(file.path.toLowerCase()); let target = base;
    for (const part of file.path.split("/")) {
      target = path.join(target, part);
      if ((await lstat(target)).isSymbolicLink() || !inside(base, await realpath(target))) throw new Error("Distribution cannot contain linked paths.");
    }
    const stat = await lstat(target);
    if (!stat.isFile() || stat.size !== file.size || createHash("sha256").update(await readFile(target)).digest("hex") !== file.sha256) throw new Error(`File changed or incomplete: ${file.path}. Re-extract the original ZIP into a new folder.`);
  }
  for (const required of ["AGENTS.md", "package.json", "package-lock.json", "scripts/portableSetup.mjs", "scripts/desktopLauncher.mjs", "server/latexPlugin.ts", "demo-paper/main.tex"]) if (!seen.has(required.toLowerCase())) throw new Error(`Missing required file: ${required}`);
  return { files: manifest.files.length, bytes: total };
}

async function run(executable, args) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject); child.once("close", resolve);
  });
  if (code !== 0) throw new Error(`Setup command failed (exit ${code}). Your papers were not changed.`);
}

export async function setup(args = []) {
  if (args.includes("--help")) { console.log("node scripts/portableSetup.mjs [--verify]\nVerify the extracted distribution. Interactive setup asks before npm dependency downloads and Windows shortcut creation."); return; }
  if (args.some(arg => arg !== "--verify")) throw new Error("Use --verify or interactive setup without flags.");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Install Node.js 24 or newer first. Setup does not download a runtime.");
  const verified = await verifyDistribution(root);
  console.log(`Verified ${verified.files} files. No personal workspace is included.`);
  if (args.includes("--verify")) return;
  if (!process.stdin.isTTY) throw new Error("Run setup interactively, or use --verify. Dependency downloads require your confirmation.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const accepted = await prompt.question("Download the locked npm dependencies and build Aw in this folder? [y/N] ");
    if (!/^y(?:es)?$/i.test(accepted.trim())) { console.log("Nothing installed. Run setup again when ready."); return; }
    // Fixed commands; no archive strings are interpolated into a shell command.
    const npm = async command => process.platform === "win32"
      ? run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"), ["/d", "/s", "/c", command])
      : run("npm", command === "npm ci" ? ["ci"] : ["run", "build"]);
    await npm("npm ci"); await npm("npm run build");
    const { seedWelcome } = await import("./seedWelcome.mjs");
    console.log((await seedWelcome(root)).seeded ? "Welcome project and unrun notebook ready." : "Existing projects and notes preserved.");
    if (process.platform === "win32" && /^y(?:es)?$/i.test((await prompt.question("Create the Active Writing desktop shortcut? [y/N] ")).trim())) {
      try { await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.join(root, "scripts", "installDesktopShortcut.ps1")]); }
      catch { console.warn("The optional shortcut was not created. Your existing shortcuts were preserved. Use Start Aw.cmd; Aw is already built. No PowerShell policy was changed."); }
    }
    console.log("Ready. Use the shortcut or Start Aw.cmd on Windows. Otherwise run node scripts/desktopServer.mjs and open http://127.0.0.1:4173/.");
  } finally { prompt.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) setup(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
