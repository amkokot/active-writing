// Bounded UI check on a fresh synthetic paper and a separate origin. No main service restart.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portableExample } from "../server/portableExport.ts";
import { registerProject } from "../server/projects.ts";
import { selectProject } from "../server/repositories.ts";
import { desktopServer } from "./desktopServer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parent = path.join(root, ".paperfocus", "trials"); await mkdir(parent, { recursive: true });
const workspace = await mkdtemp(path.join(parent, "portable-ui-"));
await mkdir(path.join(workspace, "paper")); await writeFile(path.join(workspace, "paper", "main.tex"), portableExample);
const project = await registerProject(workspace, "paper", "Fresh Aw example"); await selectProject(workspace, project.id);
const server = desktopServer(workspace); server.listen(4189, "127.0.0.1", () => console.log("Portable export UI trial: http://127.0.0.1:4189/"));
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
