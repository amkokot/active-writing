import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { shareReader, loadReader } from "./shareReader.ts";
import { compactReaderFiles, portableReaderLinks, repositoryLink } from "./readerPages.ts";
import { projectFiles } from "./projects.ts";

async function fixture() {
  const base = path.resolve(".paperfocus/trials"); await mkdir(base, { recursive: true });
  const folder = await mkdtemp(path.join(base, "reader-gate-"));
  const files = [{ name: "index.html", data: Buffer.from("<!doctype html><h1>PRIVATE_RESEARCH</h1>") }, { name: "overview.pdf", data: Buffer.from("%PDF-PRIVATE_RESEARCH") }, { name: "assets/picture.png", data: Buffer.from("PRIVATE_IMAGE") }, { name: "notebooks/conversation-1.ipynb", data: Buffer.from('{"private":"PRIVATE_NOTEBOOK"}') }];
  for (const file of files) { await mkdir(path.dirname(path.join(folder, file.name)), { recursive: true }); await writeFile(path.join(folder, file.name), file.data); }
  await writeFile(path.join(folder, "reader.json"), JSON.stringify({ format: "active-writing-reader", version: 1, files: files.map(file => ({ name: file.name, sha256: createHash("sha256").update(file.data).digest("hex") })) }));
  await writeFile(path.join(folder, "secret.txt"), "UNLISTED_SECRET");
  return folder;
}

test("reader gate protects every file, checks origin/host, expires sessions and never exposes Aw APIs", async () => {
  let time = 0;
  const folder = await fixture(), token = "A".repeat(43), server = await shareReader({ folder, token, code: "1234", origin: "https://reader.example", now: () => time, sessionMs: 10000 });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${token}/`;
  const send = (name: string, method = "GET", headers: Record<string, string> = {}, body = "") => new Promise<Response>((resolve, reject) => {
    const req = httpRequest(base + name, { method, headers: { Host: "reader.example", ...headers } }, res => { const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(chunk)); res.on("error", reject); res.on("end", () => { const pairs: [string, string][] = []; for (let i = 0; i < res.rawHeaders.length; i += 2) pairs.push([res.rawHeaders[i], res.rawHeaders[i + 1]]); resolve(new Response(Buffer.concat(chunks), { status: res.statusCode!, headers: pairs })); }); });
    req.on("error", reject); req.end(body);
  });
  const get = (name = "", cookie = "") => send(name, "GET", { Cookie: cookie });
  const unlock = (code: string, origin = "https://reader.example") => send("unlock", "POST", { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, `code=${code}`);
  try {
    const page = await get(); assert.equal(page.status, 200); assert.doesNotMatch(await page.text(), /PRIVATE_RESEARCH/);
    assert.match(page.headers.get("content-security-policy")!, /script-src 'nonce-/);
    for (const name of ["overview.pdf", "assets/picture.png", "notebooks/conversation-1.ipynb", "reader.json", "reader.zip", "secret.txt"]) { const response = await get(name); assert.equal(response.status, 303); assert.doesNotMatch(await response.text(), /PRIVATE_|UNLISTED/); }
    assert.equal((await unlock("1234", "https://foreign.example")).status, 403);
    assert.equal((await unlock("9876")).status, 401);
    const open = await unlock("1234"); assert.equal(open.status, 303);
    const setCookie = open.headers.get("set-cookie")!; assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.match(setCookie, /Secure/); const cookie = setCookie.split(";")[0];
    const content = await get("", cookie); assert.equal(content.status, 200); assert.match(await content.text(), /PRIVATE_RESEARCH/); assert.equal(content.headers.get("cache-control"), "no-store"); assert.match(content.headers.get("content-security-policy")!, /script-src 'none'/);
    assert.equal((await get("overview.pdf", cookie)).status, 200);
    const notebook = await get("notebooks/conversation-1.ipynb", cookie); assert.match(notebook.headers.get("content-disposition")!, /attachment/);
    assert.equal((await get("reader.zip", cookie)).headers.get("content-type"), "application/zip");
    for (const name of ["secret.txt", "api/paperfocus/experiments", "%2e%2e/secret.txt"]) assert.equal((await get(name, cookie)).status, 404);
    assert.equal((await send("", "GET", { Host: "evil.example" })).status, 403);
    time = 10001; assert.equal((await get("overview.pdf", cookie)).status, 303);
    // Wrong guesses use a bounded window, including a forwarded-IP spoof.
    for (let i = 0; i < 4; i++) await unlock("9999");
    const limited = await unlock("1234"); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "600");
    time += 600001; assert.equal((await unlock("1234")).status, 303);
    const jsonOpen = await send("unlock", "POST", { Origin: "https://reader.example", "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, "code=1234");
    assert.equal(jsonOpen.status, 200); assert.deepEqual(await jsonOpen.json(), { ok: true }); assert.match(jsonOpen.headers.get("set-cookie")!, /HttpOnly/);
    for (let i = 0; i < 6; i++) assert.equal((await unlock("1234")).status, 303, "Successful collaborators don't exhaust the guessing limit");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("reader loading verifies hashes, excludes unlisted files and refuses manipulated manifests", async () => {
  const folder = await fixture();
  assert.equal((await loadReader(folder)).has("secret.txt"), false);
  await writeFile(path.join(folder, "index.html"), "later edit"); await assert.rejects(loadReader(folder), /changed/);
  await writeFile(path.join(folder, "reader.json"), JSON.stringify({ format: "active-writing-reader", version: 1, files: [{ name: "../secret.txt", sha256: "0".repeat(64) }] }));
  await assert.rejects(loadReader(folder), /Invalid reader file path/);
  await assert.rejects(shareReader({ folder, token: "short", code: "1234", origin: "http://public.example" }), /fresh 32-byte/);
  await assert.rejects(shareReader({ folder, token: "A".repeat(43), code: "1234", origin: "http://public.example" }), /HTTPS/);
});

test("reader links and compact assets stay portable; ordinary aw/ source is never hidden", async () => {
  assert.equal(repositoryLink("https://github.com/a/b/"), "https://github.com/a/b");
  for (const url of ["https://name:secret@github.com/a/b", "http://github.com/a/b", "https://github.com/a/b?token=secret", "https://other.example/a/b"]) assert.throws(() => repositoryLink(url));
  const html = '<a href="file:///secret">file</a><a href="http://127.0.0.1:4173/?awProject=x">Aw</a><a href="notes/note-1.html#manuscript">note</a><a href="https://arxiv.org/abs/1234.5678">paper</a>';
  assert.doesNotMatch(portableReaderLinks(html), /href="(?:file|http:|notes)/); assert.match(portableReaderLinks(html, true), /href="notes\/note-1.html/);
  const compact = compactReaderFiles([{ name: "index.html", data: Buffer.from('<img src="data:image/png;base64,YQ==">') }, { name: "notes/note-1.html", data: Buffer.from('<img src="data:image/png;base64,YQ==">') }]);
  assert.equal(compact.filter(file => file.name.startsWith("assets/")).length, 1); assert.match(compact[1].data.toString(), /\.\.\/assets\//);
  const root = await fixture(); await mkdir(path.join(root, "aw")); await writeFile(path.join(root, "aw/main.tex"), "ordinary source"); assert.ok((await projectFiles(root)).includes("aw/main.tex"));
});
