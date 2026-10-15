import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { latexMiddleware } from "../server/latexPlugin.ts";
import { validateLaunchWorkspace } from "./desktopLauncher.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".pdf": "application/pdf" };
const contained = (base, target) => { const relative = path.relative(base, target); return !relative.startsWith("..") && !path.isAbsolute(relative); };
export function desktopServer(workspace = root, assets = path.join(root, "dist")) {
  const api = latexMiddleware(workspace);
  async function staticFile(req, res) {
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some(p => p.startsWith("."))) throw new Error("Invalid path");
      const base = await realpath(assets);
      const filename = path.resolve(base, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!contained(base, filename) || !contained(base, await realpath(filename)) || !(await stat(filename)).isFile()) throw new Error("Not a static file");
      const bytes = await readFile(filename);
      res.writeHead(200, { "Content-Type": mime[path.extname(filename)] ?? "application/octet-stream", "Content-Length": bytes.length,
        "Cache-Control": /^\/assets\/[^/]+-[\w-]{8,}\./.test(pathname) ? "public, max-age=31536000, immutable" : "no-cache", "X-Content-Type-Options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch { res.writeHead(404); res.end("Not found"); }
  }
  const server = createServer((req, res) => {
    // Retain the development server's DNS-rebinding boundary. A loopback
    // listener alone does not make arbitrary browser Host headers trustworthy.
    let trusted = false;
    try { const host = new URL(`http://${req.headers.host}`); trusted = ["localhost", "127.0.0.1", "[::1]"].includes(host.hostname) && Number(host.port || 80) === server.address()?.port; } catch { /* malformed Host */ }
    if (!trusted) { res.writeHead(403); res.end("Use the local app address."); return; }
    // Keep API failure responses JSON and never accidentally serve HTML for an unknown API.
    void api(req, res, () => {
      if (new URL(req.url, "http://localhost").pathname.startsWith("/api/")) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Unknown app endpoint." })); }
      else void staticFile(req, res);
    }).catch(error => {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message || "The request could not finish." }));
    });
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const port = Number(argument("--port") ?? 4173), workspace = validateLaunchWorkspace(path.resolve(argument("--workspace") ?? root));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local server port.");
  await stat(path.join(root, "dist", "index.html"));
  const server = desktopServer(workspace);
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`Active Writing built app: http://127.0.0.1:${port}/`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
}
