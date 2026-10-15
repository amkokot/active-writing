// Verify one exact prepared reader. Access settings arrive through hidden stdin.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("--help")) { console.log("node check.mjs --bundle PREPARED_reader-data.json\nReads {origin,token,code} as hidden JSON on stdin. Checks anonymous denial, code entry, then exact downloaded hashes at the chosen HTTPS reader. Does not publish or execute notebook code."); process.exit(0); }
if (args.length !== 2 || args[0] !== "--bundle") throw new Error("Use --bundle PREPARED_reader-data.json.");
const bundle = JSON.parse(await readFile(path.resolve(args[1]), "utf8"));
if (process.stdin.isTTY) process.stdin.setRawMode(true);
console.log("Ready for check JSON on hidden stdin.");
let input = ""; for await (const chunk of process.stdin) { input += chunk; if (input.includes("\x03")) process.exit(1); if (input.length > 3000) throw new Error("Input too large."); try { JSON.parse(input); break; } catch {} }
try {
  const { origin, token, code } = JSON.parse(input);
  if (new URL(origin).origin !== origin || !origin.startsWith("https://") || !/^[A-Za-z0-9_-]{43}$/.test(token) || !/^\d{4,12}$/.test(code)) throw new Error("Invalid exact reader scope.");
  const request = (name, options = {}) => fetch(`${origin}/${token}/${name}`, { redirect: "manual", signal: AbortSignal.timeout(25000), ...options });
  const failure = async (response, name) => { const text = await response.text(); const kind = /1102|exceeded.*CPU|CPU.*limit/i.test(text) ? "CPU limit" : text.includes("not ready") ? "missing reader settings" : text.includes("temporarily unavailable") ? "reader validation/runtime failure" : "host error"; throw new Error(`${name}: HTTP ${response.status}, ${kind}.`); };
  const locked = await request(""); if (locked.status !== 200 || !(await locked.text()).includes("Enter the code from the sender")) throw new Error("Anonymous code page unavailable.");
  for (const name of Object.keys(bundle).filter(name => name !== "index.html")) { const r = await request(name); if (r.status !== 303) await failure(r, `Before unlock ${name}`); await r.arrayBuffer(); }
  const login = await request("unlock", { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: `code=${code}` });
  if (login.status !== 200) await failure(login, "Unlock");
  if (!(await login.json()).ok) throw new Error("Unlock did not succeed.");
  const cookie = login.headers.get("set-cookie"); if (!cookie?.includes("HttpOnly") || !cookie.includes("Secure") || !cookie.includes("SameSite=Strict")) throw new Error("Missing protected session.");
  const auth = { headers: { Cookie: cookie.split(";")[0] } }, sha = bytes => createHash("sha256").update(bytes).digest("hex"); let checked = 0;
  for (const [name, value] of Object.entries(bundle)) { const r = await request(name, auth); if (r.status !== 200) await failure(r, name); if (r.headers.get("cache-control") !== "private, no-store") throw new Error(`Unsafe cache policy: ${name}`); const bytes = Buffer.from(await r.arrayBuffer()); if (sha(bytes) !== sha(Buffer.from(value, "base64"))) throw new Error(`Exact hosted hash mismatch: ${name}`); checked++; }
  if ((await request("api/paperfocus/document", auth)).status !== 404) throw new Error("Unexpected editor API.");
  console.log(JSON.stringify({ anonymousCodeEntry: true, allFilesGated: true, secureSession: true, exactFilesVerified: checked, noEditorApis: true }));
} catch (error) { console.error(error.message.replace(/https?:\/\/\S+/g, "[reader address]")); process.exitCode = 1; }
