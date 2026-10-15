import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { zipEntries } from "./sourceZip.ts";

const derive = promisify(scrypt);
const ttl = 7 * 24 * 60 * 60_000;
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".ipynb": "application/x-ipynb+json", ".json": "application/json" };
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

/** Load an immutable, hash-checked allowlist. No general filesystem server. */
export async function loadReader(folder: string) {
  if ((await lstat(folder)).isSymbolicLink()) throw new Error("Reader folder cannot be a link.");
  const root = await realpath(folder);
  async function bytes(name: string) {
    if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(name) || name.split("/").some(p => p.startsWith("."))) throw new Error("Invalid reader file path.");
    let target = root;
    for (const part of name.split("/")) { target = path.join(target, part); if ((await lstat(target)).isSymbolicLink() || !inside(root, await realpath(target))) throw new Error("Reader cannot follow file links."); }
    const info = await lstat(target); if (!info.isFile() || info.size > 100_000_000) throw new Error("Invalid or oversized reader file.");
    const handle = await open(target, "r");
    try {
      const opened = await handle.stat(); if (!opened.isFile() || opened.size !== info.size || opened.mtimeMs !== info.mtimeMs) throw new Error("Reader changed while loading.");
      const value = Buffer.alloc(info.size + 1); let length = 0;
      while (length < value.length) { const next = await handle.read(value, length, value.length - length, length); if (!next.bytesRead) break; length += next.bytesRead; }
      const final = await handle.stat();
      if (length !== info.size || final.size !== info.size || final.mtimeMs !== info.mtimeMs || (await lstat(target)).isSymbolicLink() || !inside(root, await realpath(target))) throw new Error("Reader changed while loading.");
      return value.subarray(0, length);
    } finally { await handle.close(); }
  }
  const manifestBytes = await bytes("reader.json");
  if (manifestBytes.length > 40_000) throw new Error("Reader manifest is too large.");
  const manifest = JSON.parse(manifestBytes.toString());
  if (manifest.format !== "active-writing-reader" || manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 96) throw new Error("Choose an exported Aw project reader.");
  const files = new Map<string, Buffer>(); let total = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.name !== "string" || !mime[path.extname(file.name)] || !/^[a-f0-9]{64}$/.test(file.sha256) || files.has(file.name) || ["reader.json", "reader.zip"].includes(file.name)) throw new Error("Invalid reader file manifest.");
    const value = await bytes(file.name); total += value.length;
    if (total > 100_000_000 || createHash("sha256").update(value).digest("hex") !== file.sha256) throw new Error("Reader files changed or exceed the sharing limit. Export a fresh snapshot.");
    files.set(file.name, value);
  }
  if (!files.has("index.html") || !files.has("overview.pdf")) throw new Error("Reader needs an overview and its PDF.");
  files.set("reader.json", manifestBytes);
  files.set("reader.zip", await zipEntries([...files].map(([name, data]) => ({ name: `aw/${name}`, data }))));
  return files;
}

const lockPage = (failed: boolean, nonce: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open shared reading</title><style>body{color:#25333a;background:#f3f2ed;font:16px/1.6 system-ui;margin:0}main{max-width:340px;margin:14vh auto;padding:28px;background:white;border:1px solid #ddd;border-radius:12px}h1{font-size:1.4rem}label{display:block}input,button{font:inherit;border:1px solid #bac3c5;border-radius:6px;padding:10px;box-sizing:border-box;width:100%;margin-top:8px}button{background:#355b69;color:white;cursor:pointer}small{color:#66767d}p[role=alert]{color:#9b4328}</style></head><body><main><small>Aw · shared reading</small><h1>Enter the shared code</h1><form method="post" action="unlock"><label>Access code<input name="code" type="password" inputmode="numeric" pattern="[0-9]{4,12}" minlength="4" maxlength="12" required autofocus autocomplete="off"></label><button>Open overview</button></form><p id="feedback" role="alert" ${failed ? "" : "hidden"}>Unable to open this link. Check the code or try again later.</p><p><small>Ask the sender for the code. This is a read-only copy.</small></p></main><script nonce="${nonce}">const form=document.querySelector('form'),button=form.querySelector('button'),feedback=document.querySelector('#feedback');form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;button.textContent='Opening…';feedback.hidden=true;try{const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams(new FormData(form)).toString()});if(!response.ok)throw new Error('Access denied');const result=await response.json();if(result.ok)location.assign(form.action.replace(/unlock$/,''));else throw new Error('Access denied');}catch{feedback.hidden=false;button.disabled=false;button.textContent='Open overview';}});</script></body></html>`;

/** Standalone reader only. Never mounts Aw's editor, model or Python APIs.
 * Public deployment must terminate HTTPS at a trusted proxy; this listener stays loopback.
 * A shared code is convenience access, not named-user identity or DRM.
 */
export async function shareReader(options: { folder: string; token: string; code: string; origin: string; now?: () => number; sessionMs?: number }) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(options.token) || !/^\d{4,12}$/.test(options.code)) throw new Error("Use a fresh 32-byte private link token and a 4–12 digit code, supplied outside the repository.");
  const origin = new URL(options.origin), local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.origin !== options.origin || origin.username || origin.password || origin.protocol !== "https:" && !(local && origin.protocol === "http:")) throw new Error("Reader requires an HTTPS public origin (HTTP is allowed only for local trials).");
  const files = await loadReader(options.folder), prefix = `/${options.token}/`, now = options.now ?? Date.now;
  const salt = randomBytes(16), codeHash = await derive(options.code, salt, 32) as Buffer;
  const cookieName = `aw_reader_${createHash("sha256").update(options.token).digest("hex").slice(0, 12)}`;
  const sessions = new Map<string, number>(), attempts = new Map<string, { count: number; until: number }>(); let verifying = 0;
  function limited(key: string, limit: number) {
    const value = attempts.get(key), time = now(); if (!value || value.until <= time) { attempts.set(key, { count: 1, until: time + 10 * 60_000 }); return false; }
    value.count++; return value.count > limit;
  }
  function cookie(value: string, maxAge: number) { return `${cookieName}=${value}; Path=${prefix}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.protocol === "https:" ? "; Secure" : ""}`; }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: string | Buffer, type = "text/plain; charset=utf-8") => { res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body) }); res.end(req.method === "HEAD" ? undefined : body); };
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    // A proxy must preserve the configured Host. Never trust arbitrary forwarded IP/Host.
    if (req.headers.host !== origin.host) { send(403, "Use the shared reader address."); return; }
    const raw = (req.url ?? "").split("?")[0];
    if (!raw.startsWith(prefix) || /%|\\|\0/.test(raw) || raw.split("/").some(p => p === "." || p === "..")) { send(404, "Not found."); return; }
    const name = raw.slice(prefix.length);
    const showLock = (status: number, failed = false) => {
      const nonce = randomBytes(18).toString("base64");
      // Only this tiny trusted form script can run. Shared notebook/reader pages
      // still get script-src 'none'; no executable rich output is accepted.
      res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
      send(status, lockPage(failed, nonce), "text/html; charset=utf-8");
    };
    if (name === "unlock" && req.method === "POST") {
      if (req.headers.origin !== origin.origin || req.headers["content-type"] !== "application/x-www-form-urlencoded") { send(403, "Unable to open this link."); return; }
      for (const [key, item] of attempts) if (item.until <= now()) attempts.delete(key);
      const ip = req.socket.remoteAddress ?? "unknown";
      // Small single-reader limits; do not trust X-Forwarded-For to evade them.
      const ipLimited = limited(ip, 5), globalLimited = limited("all", 30);
      const rejected = (status: number) => req.headers.accept?.includes("application/json") ? send(status, '{"ok":false}', "application/json") : showLock(status, true);
      if (ipLimited || globalLimited || attempts.size > 1024 || verifying >= 2) { res.setHeader("Retry-After", "600"); rejected(429); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 128) { send(413, "Request too large."); return; } chunks.push(Buffer.from(chunk)); }
      const code = new URLSearchParams(Buffer.concat(chunks).toString()).get("code") ?? "";
      if (!/^\d{4,12}$/.test(code)) { rejected(401); return; }
      verifying++; let correct = false;
      try { correct = timingSafeEqual(await derive(code, salt, 32) as Buffer, codeHash); } finally { verifying--; }
      if (!correct) { rejected(401); return; }
      // Successful visitors should not consume the guessing budget, especially
      // when collaborators share a reverse proxy's socket address.
      for (const key of [ip, "all"]) { const item = attempts.get(key); if (item) item.count = Math.max(0, item.count - 1); }
      for (const [key, expires] of sessions) if (expires <= now()) sessions.delete(key);
      if (sessions.size >= 512) { send(503, "Please try again later."); return; }
      const session = randomBytes(32).toString("base64url"), duration = options.sessionMs ?? ttl;
      sessions.set(session, now() + duration); res.setHeader("Set-Cookie", cookie(session, Math.floor(duration / 1000)));
      if (req.headers.accept?.includes("application/json")) send(200, '{"ok":true}', "application/json");
      else { res.setHeader("Location", prefix); send(303, "Open overview."); } return;
    }
    if (!["GET", "HEAD"].includes(req.method ?? "")) { send(405, "Read-only reader."); return; }
    const session = req.headers.cookie?.split(";").map(p => p.trim()).find(p => p.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!session || (sessions.get(session) ?? 0) <= now()) {
      if (!name || name === "index.html") showLock(200);
      else { res.setHeader("Location", prefix); send(303, "Enter the shared code first."); } return;
    }
    const target = name || "index.html", value = files.get(target);
    if (!value) { send(404, "Not found."); return; }
    const type = target === "reader.zip" ? "application/zip" : mime[path.extname(target)];
    if ([".ipynb", ".zip"].includes(path.extname(target)) || new URL(req.url!, origin).searchParams.get("download") === "1") res.setHeader("Content-Disposition", `attachment; filename="${path.basename(target)}"`);
    send(200, value, type);
  }
  const server = createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end("The reader could not finish this request."); }); });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxHeadersCount = 30;
  return server;
}
