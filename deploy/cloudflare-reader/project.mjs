// Prepare an inspected Aw reader for a new project. No network or credentials.
import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadReader } from "../../server/shareReader.ts";

export function configuration({ name, account, subdomain, database }) {
  if (!/^aw-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 63 || !/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.workers\.dev$/.test(subdomain) || !/^[a-f0-9-]{36}$/.test(database)) throw new Error("Use a project slug and actual confirmed Cloudflare account/subdomain/database IDs.");
  return { name, account_id: account, main: "worker.mjs", compatibility_date: "2026-10-14", compatibility_flags: ["nodejs_compat"], workers_dev: true, preview_urls: false, observability: { enabled: false }, d1_databases: [{ binding: "DB", database_name: "aw-reader-limits", database_id: database }], origin: `https://${name}.${subdomain}` };
}
export function buildWorker(source, files) {
  const marker = "const FILES = null; // AW_READER_FILES";
  const decoder = 'const unbase64 = value => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));';
  const budgets = 'const keys = ["global", `ip:${hashedIp}`];';
  if (source.split(marker).length !== 2 || !source.includes(decoder) || !source.includes(budgets)) throw new Error("Reader implementation changed: inspect the deployment adapter before building.");
  const bundle = Object.fromEntries([...files].map(([name, value]) => [name, value.toString("base64")]));
  if (Buffer.byteLength(JSON.stringify(bundle)) > 11_000_000 || [...files.values()].reduce((n, value) => n + value.length, 0) > 8_000_000) throw new Error("Select a smaller reading snapshot; nothing is truncated.");
  // Native Buffer decoding avoids millions of per-byte JS callbacks on Free.
  // Keep every content hash check, cookie/code guard and immutable allowlist.
  const worker = 'import { Buffer } from "node:buffer";\n' + source.replace(marker, `const FILES = ${JSON.stringify(bundle)}; // Checked private reader bytes`).replace(decoder, 'const unbase64 = value => Buffer.from(value, "base64url");').replace(budgets, 'const scope = base64(new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(env.AW_SHARE_TOKEN)))); const keys = [`project:${scope}:global`, `project:${scope}:ip:${hashedIp}`];');
  return { worker, bundle };
}
export async function prepare(options) {
  const config = configuration(options), output = path.resolve(options.output);
  try { await lstat(output); throw new Error("Choose a NEW absent output folder; existing deployments are preserved."); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const files = await loadReader(path.resolve(options.reader));
  for (const [name, bytes] of files) if (/\.(html|md|txt|ipynb)$/.test(name) && /(?:127\.0\.0\.1|localhost|awProject=|C:\\\\?Users\\|\.paperfocus\/project-data)/i.test(bytes.toString())) throw new Error(`Review local/private authored context in ${name} before publishing.`);
  const source = await readFile(new URL("./reader/worker.js", import.meta.url), "utf8");
  const built = buildWorker(source, files), { origin, ...wrangler } = config;
  const plan = { version: 1, name: options.name, account: options.account, database: options.database, origin, sourceReader: path.resolve(options.reader), readerSha256: createHash("sha256").update(files.get("reader.json")).digest("hex"), workerSha256: createHash("sha256").update(built.worker).digest("hex"), files: files.size, bytes: [...files.values()].reduce((n, b) => n + b.length, 0), published: false };
  await mkdir(output, { recursive: true });
  for (const [name, text] of [["worker.mjs", built.worker], ["reader-data.json", JSON.stringify(built.bundle)], ["wrangler.json", JSON.stringify(wrangler, null, 2)], ["plan.json", JSON.stringify(plan, null, 2)]]) await writeFile(path.join(output, name), text, { flag: "wx" });
  return { ...plan, folder: output };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) console.log("project.mjs --reader EXPORTED_aw --name aw-project-slug --account ACCOUNT_ID --subdomain ACCOUNT.workers.dev --database CONFIRMED_D1_ID --output NEW_FOLDER\nOffline preparation only. Reuses an authorized D1 with project-isolated guessing budgets. No upload, source changes, API keys or credentials. Inspect plan.json before publishing.");
  else {
    const options = {}; for (let i = 0; i < args.length; i += 2) { const name = args[i].slice(2); if (!["reader", "name", "account", "subdomain", "database", "output"].includes(name) || options[name] || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Use --help for explicit project-sharing scope."); options[name] = args[i + 1]; }
    console.log(JSON.stringify(await prepare(options), null, 2));
  }
}
