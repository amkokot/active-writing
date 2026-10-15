// Wrangler receives secrets through a pipe; the terminal never echoes them.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
if (args.includes("--help")) { console.log("node secrets.mjs --config EXACT_WRANGLER_CONFIG\nReads only AW_SHARE_ORIGIN, AW_SHARE_TOKEN, AW_SESSION_SECRET, AW_CODE_SALT and AW_CODE_HASH as one hidden JSON object on stdin. Requires Wrangler installed in this tooling folder. Does not accept secrets in arguments."); process.exit(0); }
if (args.length !== 2 || args[0] !== "--config") throw new Error("Use --config EXACT_WRANGLER_CONFIG.");
const config = path.resolve(args[1]);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write("Ready for reader-secret JSON on hidden stdin.\n");
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.includes("\x03")) process.exit(1);
  if (input.length > 3000) throw new Error("Secret input too large.");
  try { JSON.parse(input); break; } catch { /* Stop on a complete JSON object. */ }
}
const values = JSON.parse(input), names = ["AW_SHARE_ORIGIN", "AW_SHARE_TOKEN", "AW_SESSION_SECRET", "AW_CODE_SALT", "AW_CODE_HASH"];
if (Object.keys(values).sort().join() !== names.sort().join()) throw new Error("Only reader protection settings are accepted.");
if (new URL(values.AW_SHARE_ORIGIN).origin !== values.AW_SHARE_ORIGIN || !values.AW_SHARE_ORIGIN.startsWith("https://") || !/^[A-Za-z0-9_-]{22}$/.test(values.AW_CODE_SALT) || names.filter(n => !["AW_SHARE_ORIGIN", "AW_CODE_SALT"].includes(n)).some(n => !/^[A-Za-z0-9_-]{43}$/.test(values[n]))) throw new Error("Invalid reader secrets.");
const child = spawn(process.execPath, [fileURLToPath(new URL("node_modules/wrangler/bin/wrangler.js", import.meta.url)), "secret", "bulk", "--config", config], { cwd: fileURLToPath(new URL(".", import.meta.url)), env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
const redact = chunk => { let text = chunk.toString(); for (const value of Object.values(values)) text = text.replaceAll(value, "[reader secret]"); return text; };
child.stdout.on("data", chunk => process.stdout.write(redact(chunk)));
child.stderr.on("data", chunk => process.stderr.write(redact(chunk)));
child.on("error", () => { console.error("Unable to start the installed deployment tool."); process.exitCode = 1; });
child.on("close", code => { process.exitCode = code ?? 1; });
child.stdin.end(JSON.stringify(values));
