// Compiled checked reader bytes only. Never deploy a public/static asset directory.
const FILES = null; // AW_READER_FILES
const encoder = new TextEncoder(), ttl = 7 * 86400;
const mime = { html: "text/html; charset=utf-8", pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", md: "text/plain; charset=utf-8", txt: "text/plain; charset=utf-8", json: "application/json", ipynb: "application/x-ipynb+json", zip: "application/zip" };
const safeName = name => /^[\w.-]+(?:\/[\w.-]+)*$/.test(name) && !name.split("/").some(p => p.startsWith("."));
const base64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const unbase64 = value => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
const equal = (a, b) => { if (a.length !== b.length) return false; let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]; return difference === 0; };
const security = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
const page = (failed, nonce) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aw · shared reading</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f3ef;color:#25343b;font:16px/1.6 system-ui}main{width:min(380px,calc(100% - 40px));margin:16vh auto;padding:30px;background:#fff;border:1px solid #dce1df;border-radius:12px;box-shadow:0 10px 36px #273d4510}.brand{color:#65767a;font-size:13px}h1{font-size:24px;font-weight:600;line-height:1.3;margin:20px 0 10px}p{font-size:14px;color:#637177}label{display:block;font-size:14px;margin:20px 0 8px}input,button{font:inherit;width:100%;border:1px solid #b8c5c8;border-radius:6px;padding:10px 12px}input{letter-spacing:4px;font-variant-numeric:tabular-nums}button{margin-top:16px;background:#355b69;color:#fff;cursor:pointer}input:focus,button:focus{outline:2px solid #91b7b7;outline-offset:3px}.error{color:#984730}footer{font-size:12px;color:#748185;margin-top:24px}</style></head><body><main><div class="brand">Aw · shared reading</div><h1>Open the research</h1><p>Enter the code from the sender.</p><form method="post" action="unlock"><label for="code">Access code</label><input id="code" name="code" type="password" inputmode="numeric" pattern="[0-9]{4,12}" minlength="4" maxlength="12" required autofocus autocomplete="off"><button type="submit">Open overview</button></form><p id="feedback" role="alert" class="error" ${failed ? "" : "hidden"}>That did not open the link. Check the code, or try again later.</p><footer>A read-only copy. Nothing to install.</footer></main><script nonce="${nonce}">const form=document.querySelector('form'),button=form.querySelector('button'),feedback=document.querySelector('#feedback');form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;button.textContent='Opening…';feedback.hidden=true;try{const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams(new FormData(form)).toString()});if(!response.ok)throw Error('Access denied');const answer=await response.json();if(!answer.ok)throw Error('Access denied');location.assign(form.action.replace(/unlock$/,''));}catch{feedback.hidden=false;button.disabled=false;button.textContent='Open overview';}});</script></body></html>`;

export function createReader(bundle, now = Date.now) {
  let validated;
  async function files() {
    if (!validated) validated = (async () => {
      if (!bundle || typeof bundle !== "object" || Object.keys(bundle).length > 98) throw new Error("Invalid reader bundle");
      const manifest = JSON.parse(new TextDecoder().decode(unbase64(bundle["reader.json"])));
      if (manifest.format !== "active-writing-reader" || manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 96) throw new Error("Invalid reader manifest");
      const map = new Map(); let total = 0;
      for (const item of manifest.files) {
        if (!safeName(item.name) || !mime[item.name.split(".").at(-1)] || !/^[a-f0-9]{64}$/.test(item.sha256) || map.has(item.name) || ["reader.json", "reader.zip"].includes(item.name)) throw new Error("Invalid reader file");
        const bytes = unbase64(bundle[item.name]); total += bytes.length;
        if (total > 8_000_000) throw new Error("Use a smaller hosted snapshot");
        const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
        if (sha !== item.sha256) throw new Error("Reader hash mismatch"); map.set(item.name, bytes);
      }
      if (!map.has("index.html") || !map.has("overview.pdf")) throw new Error("Reader missing overview");
      map.set("reader.json", unbase64(bundle["reader.json"]));
      const zip = unbase64(bundle["reader.zip"]); if (zip.length > 8_000_000 || zip[0] !== 80 || zip[1] !== 75) throw new Error("Invalid reading ZIP"); map.set("reader.zip", zip);
      if (Object.keys(bundle).some(name => !map.has(name))) throw new Error("Unlisted bundle bytes");
      return map;
    })();
    return validated;
  }
  return async (request, env) => {
    const url = new URL(request.url), headers = new Headers(security);
    const respond = (status, body, type = "text/plain; charset=utf-8") => { headers.set("Content-Type", type); return new Response(request.method === "HEAD" ? null : body, { status, headers }); };
    const lockPage = (status, failed = false) => { const nonce = base64(crypto.getRandomValues(new Uint8Array(18))); headers.set("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`); return respond(status, page(failed, nonce), "text/html; charset=utf-8"); };
    try {
      const origin = new URL(env.AW_SHARE_ORIGIN);
      if (origin.origin !== env.AW_SHARE_ORIGIN || origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname)) || !/^[A-Za-z0-9_-]{43}$/.test(env.AW_SHARE_TOKEN) || !/^[A-Za-z0-9_-]{43}$/.test(env.AW_SESSION_SECRET) || !/^[A-Za-z0-9_-]{22}$/.test(env.AW_CODE_SALT) || !/^[A-Za-z0-9_-]{43}$/.test(env.AW_CODE_HASH) || !env.DB) return respond(503, "This reading link is not ready.");
      if (url.origin !== origin.origin) return respond(403, "Use the shared reading address.");
      const prefix = `/${env.AW_SHARE_TOKEN}/`;
      if (!url.pathname.startsWith(prefix) || /%|\\|\0/.test(url.pathname)) return respond(404, "Not found.");
      const name = url.pathname.slice(prefix.length);
      if (name && !safeName(name)) return respond(404, "Not found.");
      const secure = origin.protocol === "https:", cookieName = "aw_read", cookie = (value, age) => `${cookieName}=${value}; Path=${prefix}; Max-Age=${age}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
      const hmacKey = await crypto.subtle.importKey("raw", unbase64(env.AW_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
      const sign = async payload => `${payload}.${base64(new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(`${env.AW_CODE_HASH}:${env.AW_SHARE_TOKEN}:${payload}`))))}`;
      if (name === "unlock" && request.method === "POST") {
        if (request.headers.get("Origin") !== origin.origin || !/^application\/x-www-form-urlencoded(?:;.*)?$/.test(request.headers.get("Content-Type") ?? "")) return respond(403, "Unable to open this link.");
        if (Number(request.headers.get("Content-Length") ?? 0) > 128) return respond(413, "Request too large.");
        const reader = request.body?.getReader(); let length = 0, body = "";
        if (reader) { for (;;) { const result = await reader.read(); if (result.done) break; length += result.value.length; if (length > 128) { await reader.cancel(); return respond(413, "Request too large."); } body += new TextDecoder().decode(result.value); } }
        const code = new URLSearchParams(body).get("code") ?? "";
        const reject = status => request.headers.get("Accept")?.includes("application/json") ? respond(status, '{"ok":false}', "application/json") : lockPage(status, true);
        if (!/^\d{4,12}$/.test(code)) return reject(401);
        const time = now(), until = time + 600000;
        // CF-Connecting-IP is edge-owned; never use X-Forwarded-For. Without
        // trusted edge metadata visitors share a stricter global-only budget.
        const ip = request.cf ? request.headers.get("CF-Connecting-IP") : null;
        const hashedIp = ip ? base64(new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(ip)))) : "shared";
        const keys = ["global", `ip:${hashedIp}`];
        await env.DB.prepare("DELETE FROM aw_reader_attempts WHERE until < ?").bind(time - 86400000).run();
        const results = await env.DB.batch(keys.map(key => env.DB.prepare("INSERT INTO aw_reader_attempts (key, count, until) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN until <= ? THEN 1 ELSE count + 1 END, until = CASE WHEN until <= ? THEN ? ELSE until END RETURNING count, until").bind(key, until, time, time, until)));
        const rows = results.map(result => result.results?.[0]);
        if (rows.some(row => !row) || rows[0].count > 30 || rows[1].count > 5) { headers.set("Retry-After", "600"); return reject(429); }
        const password = await crypto.subtle.importKey("raw", encoder.encode(code), "PBKDF2", false, ["deriveBits"]);
        const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unbase64(env.AW_CODE_SALT), iterations: 100000 }, password, 256));
        if (!equal(derived, unbase64(env.AW_CODE_HASH))) return reject(401);
        await env.DB.batch(keys.map((key, index) => env.DB.prepare("UPDATE aw_reader_attempts SET count = MAX(0, count - 1) WHERE key = ? AND until = ?").bind(key, rows[index].until)));
        const payload = base64(encoder.encode(JSON.stringify({ expires: time + ttl * 1000, nonce: base64(crypto.getRandomValues(new Uint8Array(16))) })));
        headers.set("Set-Cookie", cookie(await sign(payload), ttl));
        if (request.headers.get("Accept")?.includes("application/json")) return respond(200, '{"ok":true}', "application/json");
        headers.set("Location", prefix); return respond(303, "Open overview.");
      }
      if (!["GET", "HEAD"].includes(request.method)) return respond(405, "Read-only copy.");
      const session = request.headers.get("Cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      let authenticated = false;
      if (session && session.length < 400 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(session)) {
        const [payload, signature] = session.split(".");
        const valid = await crypto.subtle.verify("HMAC", hmacKey, unbase64(signature), encoder.encode(`${env.AW_CODE_HASH}:${env.AW_SHARE_TOKEN}:${payload}`));
        if (valid) { const claims = JSON.parse(new TextDecoder().decode(unbase64(payload))); authenticated = Number.isFinite(claims.expires) && claims.expires > now() && claims.expires <= now() + ttl * 1000; }
      }
      if (!authenticated) { if (!name || name === "index.html") return lockPage(200); headers.set("Location", prefix); return respond(303, "Enter the code first."); }
      const allowed = await files(), target = name || "index.html", bytes = allowed.get(target);
      if (!bytes) return respond(404, "Not found.");
      if (["zip", "ipynb"].includes(target.split(".").at(-1)) || url.searchParams.get("download") === "1") headers.set("Content-Disposition", `attachment; filename="${target.split("/").at(-1)}"`);
      headers.set("Content-Length", String(bytes.length)); return respond(200, bytes, mime[target.split(".").at(-1)]);
    } catch { return respond(503, "This reading link is temporarily unavailable."); }
  };
}

const handle = createReader(FILES);
export default { fetch: (request, env) => handle(request, env) };
