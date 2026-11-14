/** Scoped read-only model helper. Does not save notebook cells or execute suggestions. */
import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { offlineResearchRequest } from "./awOffline.ts";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("Desktop-only bounded local proposals; no server, cloud or generated-code execution.\nnode scripts/awDelegate.ts status\nnode scripts/awDelegate.ts ask --workspace HOME --project ID --entry ID --file REQUEST.json [--fresh]\nREQUEST: {version:1, task:extract|logs|tests|review|rewrite, instruction:..., context:[{id:...,text:...}]}\nOwnership is validated and added by the tool. Saves receipts in the owning research folder; import useful findings through awResearch, not direct JSON writes.");
} else {
  const command = args.shift();
  if (!["ask", "status"].includes(command!)) throw new Error("Use ask or status");
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i].slice(2);
    if (!args[i].startsWith("--") || !["workspace", "project", "entry", "file", "fresh"].includes(name) || flags[name] !== undefined) throw new Error("Unknown/repeated option");
    if (name === "fresh") flags[name] = "true";
    else if (args[i + 1] && !args[i + 1].startsWith("--")) flags[name] = args[++i];
    else throw new Error("Missing option value");
  }
  const pythonArgs = [path.join(path.dirname(fileURLToPath(import.meta.url)), "awDelegate.py"), command!];
  if (command === "ask") {
    for (const name of ["workspace", "project", "entry", "file"]) if (!flags[name]) throw new Error(`Provide --${name}`);
    const request = await offlineResearchRequest("inspect", flags);
    const notebook = await request("notebook"), entry = notebook.entries.find((e: { id: string }) => e.id === flags.entry);
    const folders = await request("workspace-folders");
    const content = await readFile(flags.file);
    if (content.length > 100_000) throw new Error("Request is too large; select bounded excerpts");
    const packet = JSON.parse(content.toString());
    if (Object.keys(packet).some(k => !["version", "task", "instruction", "context"].includes(k))) throw new Error("Only version/task/instruction/context are accepted; ownership comes from saved records");
    packet.owner = { project: flags.project, entry: flags.entry, notebook: entry.experimentNotebookId ?? entry.id };
    const records = path.join(folders.data.path, "research");
    await mkdir(records, { recursive: true });
    if (await realpath(records) !== records) throw new Error("Linked research folder refused");
    const destination = path.join(records, `delegate-request-${randomUUID()}.json`);
    await writeFile(destination, JSON.stringify(packet), { flag: "wx", mode: 0o600 });
    pythonArgs.push("--request", destination, "--records", records);
    if (flags.fresh) pythonArgs.push("--fresh");
  } else if (Object.keys(flags).length) throw new Error("status takes no scope/options and does not contact the runtime");
  const python = process.env.AW_DELEGATE_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const child = spawn(python, pythonArgs, { stdio: "inherit", shell: false, windowsHide: true });
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
