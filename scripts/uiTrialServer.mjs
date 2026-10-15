// Isolated UI trials must not share a registry, manuscript or browser origin
// with the author's workspace. All trial data stays below .paperfocus/trials.
import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { latexPlugin } from "../server/latexPlugin.ts";
import { registerProject } from "../server/projects.ts";
import { selectProject } from "../server/repositories.ts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trialsRoot = await realpath(path.join(appRoot, ".paperfocus", "trials"));
const workspace = await realpath(path.resolve(appRoot, process.argv[2] || ""));
const relative = path.relative(trialsRoot, workspace);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Choose an existing isolated workspace inside .paperfocus/trials.");
const port = Number(process.argv[3] || 4176);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4173) throw new Error("Choose a separate local trial port.");
const project = await registerProject(workspace, "paper", "Isolated block editing trial");
await selectProject(workspace, project.id);
const server = await createServer({ configFile: false, root: appRoot, cacheDir: path.join(workspace, ".paperfocus/vite-cache"), plugins: [react(), latexPlugin(workspace)],
  // The dev server needs app-code changes, not watches on OneDrive manuscripts
  // and large/locked PDFs. Source monitoring reads the isolated paper itself.
  server: { host: "127.0.0.1", port, strictPort: true, watch: { ignored: ["**/.paperfocus/**", "**/problem-lab/**", "**/output/**", "**/tmp/**", "**/*.pdf", "**/*.tex", "**/*.bib", "**/*.ipynb"] } }, logLevel: "warn" });
await server.listen();
console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/`, workspace, projectId: project.id }));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await server.close(); process.exit(0); });
