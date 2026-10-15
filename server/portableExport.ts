import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { zipEntries } from "./sourceZip.ts";

// Distribution is deliberately not a workspace backup. Never walk Aw home,
// the existing demo paper, personal Codex home, or the development README.
const rootFiles = ["AGENTS.md", "LICENSE", "package.json", "package-lock.json", "index.html", "vite.config.ts", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json"];
const guides = ["AGENT_GUIDE.md", "RESEARCH_WORKFLOW.md", "WRITING_WORKFLOW.md", "REMOTE_RESEARCH.md", "PRESENTATION_REVISION_NOTES.md", "PORTABLE_AW.md", "DEVICE_SYNC.md"];
const tools = ["awResearch.ts", "awOffline.ts", "awVersions.ts", "awWriting.ts", "awAgentState.ts", "awSync.ts", "awShare.ts", "awShareTypeset.ts", "awSharePdf.py", "syncAgentTrial.mjs", "desktopLauncher.mjs", "desktopServer.mjs", "desktopBuild.mjs", "installDesktopShortcut.ps1", "research-requirements.txt", "scientificSmoke.py", "checkChanges.mjs", "checkPlan.mjs", "shareReaderServer.mjs", "exportAw.mjs", "portableSetup.mjs", "seedWelcome.mjs", "preparePublicAw.mjs", "portableAwTrial.mjs", "uiTrialServer.mjs", "sharingPdfTrial.ts"];
const deployment = ["project.mjs", "project.test.mjs", "secrets.mjs", "check.mjs", "reader/worker.js", "reader/schema.sql"];
const maxFiles = 2500, maxFileBytes = 8 * 1024 * 1024, maxBytes = 48 * 1024 * 1024;
type Entry = { name: string; data: Buffer };
type File = { name: string; source: string; size: number; mtimeMs: number; ctimeMs: number };
const contained = (root: string, target: string) => { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };

export const portableReadme = `# Active Writing — start here

This is a clean copy of Aw: a local LaTeX editor, notebook and research harness.
It includes the app source, agent instructions, guarded command-line tools and a
fresh example. It does not include the sender's papers, notebooks, accounts,
browser drafts, Codex chats, personal settings, model weights or installed libraries.

## First setup

1. Extract the whole ZIP into a permanent folder you own, not inside another
   Aw installation or a live paper repository. Keep one authoritative Aw host.
2. Install Node.js 24 or newer separately if it is not already available.
3. On Windows, double-click **Set up Aw.cmd**. It verifies the bundle, asks before
   downloading the locked npm dependencies, builds the app, and offers a desktop
   shortcut. No Python libraries or models are automatically downloaded.
   On other systems run \`node scripts/portableSetup.mjs\` in this folder.
4. On Windows use the new **Active Writing** shortcut or **Start Aw.cmd**.
   Otherwise run \`node scripts/desktopServer.mjs\`, then open
   http://127.0.0.1:4173/ in your browser. The Windows shortcut manages its local
   server automatically; you do not need to start it by hand each time.
5. Use the folder button to create/import your own project. The example is safe
   to edit. An occupied port is never taken over or another Aw server stopped.

## Agents and optional tools

Open your own assistant in this Aw folder and ask it to read AGENTS.md and
docs/AGENT_GUIDE.md. Use the app's Copy workspace note / assistant instructions
for a specific paper or notebook. The offline harness works without the Aw server:
\`node scripts/awResearch.ts --help\`.

Sign into your own Codex or other assistant separately. This package does not
include a subscription, paid API integration, personal Codex skills or credentials.
Python experiments require your permission and an installed interpreter; the
optional library list is scripts/research-requirements.txt. LaTeX PDF compilation
requires a TeX installation. Local models require separate installation/configuration.
See docs/PORTABLE_AW.md for transfer limits and a private-workspace backup checklist.

This is a source distribution, not a bundled Node/Python/TeX installer. Initial npm
setup needs internet access. Windows is the tested desktop path; other operating
systems may need tool configuration. Manifest hashes detect changes, not publisher
authenticity: accept executable code only from a sender you trust. Review the source
before running setup. Nothing is uploaded or published by export or verification.
`;

export const portableExample = String.raw`\documentclass{article}
\usepackage{amsmath,amssymb,amsthm,hyperref}
\newtheorem{theorem}{Theorem}
\title{Welcome to Active Writing}
\author{}
\date{}
\begin{document}
\maketitle
\section{Start with an idea}
This is a fresh example, not the sender's research. Edit it, ask a question,
or create your own project using the folder button.

\section{A small result}
\begin{theorem}[A useful identity]\label{thm:identity}
For real numbers $a,b$, $(a+b)^2=a^2+2ab+b^2$.
\end{theorem}
\begin{proof}
Expand the product $(a+b)(a+b)$ and collect the terms.
\end{proof}

\section{Keep the evidence nearby}
Use the notebook for questions, derivations and experiments. Saved notes and
outputs remain local. Models do not approve publication text or resolve your comments.
\end{document}
`;

async function inventory(root: string) {
  const files: File[] = []; let bytes = 0;
  async function add(name: string, source = name) {
    const target = path.join(root, source), info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile() || !contained(root, await realpath(target))) throw new Error("An app file is linked or moved. Export stopped; nothing was changed.");
    if (info.size > maxFileBytes || (bytes += info.size) > maxBytes || files.length >= maxFiles) throw new Error("Aw export is limited to 2,500 files, 8 MB per file and 48 MB total.");
    files.push({ name, source, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
  }
  async function walk(relative: string, kind: "src" | "server" | "public" | "distribution", depth = 0) {
    if (depth > 16) throw new Error("App folders are too deeply nested.");
    const folder = path.join(root, relative), info = await lstat(folder);
    if (info.isSymbolicLink() || !info.isDirectory() || !contained(root, await realpath(folder))) throw new Error("An app folder is linked. Export stopped.");
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || ["node_modules", "__pycache__", "dist"].includes(entry.name)) continue;
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("App exports cannot follow file links.");
      if (entry.isDirectory()) await walk(name, kind, depth + 1);
      else if (entry.isFile() && (kind === "src" ? /\.(?:ts|tsx|css|svg)$/.test(name) : kind === "server" ? /\.(?:ts|py)$/.test(name) : kind === "public" ? /\.(?:svg|png|ico|woff2?|ttf|txt)$/.test(name) : /\.(?:md|tex)$/.test(name))) await add(name);
    }
  }
  for (const name of rootFiles) await add(name);
  for (const name of guides) await add(`docs/${name}`);
  for (const name of tools) await add(`scripts/${name}`);
  for (const name of deployment) await add(`deploy/cloudflare-reader/${name}`);
  await add("distribution/.gitignore");
  await add("docs/ONLINE_SHARING.md", "distribution/ONLINE_SHARING.md");
  await add("docs/GETTING_STARTED.md", "distribution/GETTING_STARTED.md");
  await add("deploy/cloudflare-reader/README.md", "distribution/READER_SETUP.md");
  for (const entry of await readdir(path.join(root, "scripts"), { withFileTypes: true })) if (/\.test\.mjs$/.test(entry.name)) await add(`scripts/${entry.name}`);
  for (const [folder, kind] of [["src", "src"], ["server", "server"], ["public", "public"], ["distribution", "distribution"]] as const) await walk(folder, kind);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function portableEntries(appRoot: string) {
  const root = await realpath(appRoot), before = await inventory(root), entries: Entry[] = [];
  for (const file of before) {
    // Recheck every parent: lstat(file) alone doesn't reject a swapped folder link.
    let target = root;
    for (const part of file.source.split("/")) {
      target = path.join(target, part);
      if ((await lstat(target)).isSymbolicLink() || !contained(root, await realpath(target))) throw new Error("App files moved during export. Try again after edits settle.");
    }
    const handle = await open(target, "r");
    try {
      const info = await handle.stat();
      if (info.size !== file.size || info.mtimeMs !== file.mtimeMs || info.ctimeMs !== file.ctimeMs) throw new Error("App files changed during export. Try again.");
      const bytes = Buffer.alloc(file.size + 1); let length = 0;
      while (length < bytes.length) { const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length); if (!bytesRead) break; length += bytesRead; }
      const after = await handle.stat();
      if (length !== file.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error("App files changed during export. Try again.");
      entries.push({ name: file.name, data: bytes.subarray(0, length) });
    } finally { await handle.close(); }
  }
  if (JSON.stringify(before) !== JSON.stringify(await inventory(root))) throw new Error("App files changed during export. Try again.");
  // No old registry, original demo text or development history travels with Aw.
  const template = (name: string) => entries.find(entry => entry.name === `distribution/${name}`)!.data;
  entries.push({ name: "README.md", data: template("README.md") }, { name: ".gitignore", data: template(".gitignore") },
    { name: ".gitattributes", data: Buffer.from("# Preserve distribution hashes across Git clones on Windows.\n* -text\n") },
    { name: "Set up Aw.cmd", data: Buffer.from('@echo off\r\ncd /d "%~dp0"\r\nnode scripts\\portableSetup.mjs\r\npause\r\n') },
    { name: "Start Aw.cmd", data: Buffer.from('@echo off\r\ncd /d "%~dp0"\r\nnode scripts\\desktopLauncher.mjs\r\nif errorlevel 1 pause\r\n') });
  for (const entry of entries.filter(entry => entry.name.startsWith("distribution/demo/"))) entries.push({ name: entry.name.replace("distribution/demo/", "demo-paper/"), data: entry.data });
  const manifest = { format: "active-writing-distribution", version: 1, createdAt: new Date().toISOString(),
    appVersion: JSON.parse(entries.find(entry => entry.name === "package.json")!.data.toString()).version,
    privateWorkspaceIncluded: false, setup: "scripts/portableSetup.mjs", files: entries.map(entry => ({ path: entry.name, size: entry.data.length, sha256: createHash("sha256").update(entry.data).digest("hex") })) };
  entries.push({ name: "aw-distribution.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n") });
  return { entries, manifest };
}

export async function portableZip(appRoot: string) { return zipEntries((await portableEntries(appRoot)).entries); }
